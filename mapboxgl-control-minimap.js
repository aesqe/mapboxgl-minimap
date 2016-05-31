function Minimap(options)
{
	mapboxgl.util.setOptions(this, options);
}

Minimap.prototype = mapboxgl.util.inherit(mapboxgl.Control, {

	options: {
		id: "mapboxgl-minimap",
		position: "bottom-left",
		width: "320px",
		height: "181px",
		style: "mapbox://styles/mapbox/streets-v8",
		center: [0, 0],

		zoom: 6,
		zoomAdjust: null, // should be a function; will be bound to Minimap
		zoomLevels: [
			// if parent map zoom >= 18 and minimap zoom >= 14, set minimap zoom to 16
			[18, 14, 16],
			[16, 12, 14],
			[14, 10, 12],
			[12, 8, 10],
			[10, 6, 8]
		],
		
		bounds: "parent",

		lineColor: "#08F",
		lineWidth: 1,
		lineOpacity: 1,

		fillColor: "#F80",
		fillOpacity: 0.25,

		dragPan: false,
		scrollZoom: false
	},

	onAdd: function( map )
	{
		this._parentMap = map;
		this._isDragging = false;
		this._isCursorOverFeature = false;
		this._previousPoint = [0, 0];
		this._currentPoint = [0, 0];

		var self = this;
		var opts = this.options;
		var container = this._createContainer(map);

		var miniMap = this._miniMap = new mapboxgl.Map({
			attributionControl: false,
			container: container,
			style: opts.style,
			zoom: opts.zoom,
			center: opts.center
		});

		var miniMapCanvas = miniMap.getCanvasContainer();

		if( typeof opts.zoomAdjust === "function" ) {
			this.options.zoomAdjust = opts.zoomAdjust.bind(this);
		} else if( opts.zoomAdjust === null ) {
			this.options.zoomAdjust = this._zoomAdjust.bind(this);
		}

		if( ! opts.dragPan ) {
			miniMap.dragPan.disable();
		}

		if( ! opts.scrollZoom ) {
			miniMap.scrollZoom.disable();
		}
		
		miniMap.on("style.load", function()
		{
			if( opts.bounds === "parent" ) {
				opts.bounds = map.getBounds();
			}

			if( typeof opts.bounds === "object" ) {
				miniMap.fitBounds(opts.bounds, {padding: 5, duration: 50});
			}

			miniMap.addSource("trackingRect", {
				"type": "geojson",
				"data": self._getTrackingRectFeature()
			});

			miniMap.addLayer({
				"id": "trackingRectOutline",
				"type": "line",
				"source": "trackingRect",
				"layout": {},
				"paint": {
					"line-color": opts.lineColor,
					"line-width": opts.lineWidth,
					"line-opacity": opts.lineOpacity
				}
			});

			// needed for dragging
			miniMap.addLayer({
				"id": "trackingRectFill",
				"type": "fill",
				"source": "trackingRect",
				"layout": {},
				"paint": {
					"fill-color": opts.fillColor,
					"fill-opacity": opts.fillOpacity
				}
			});

			map.on("zoom", self._update.bind(self));
			map.on("move", self._update.bind(self));

			self._update();
		});

		miniMap.on("mousemove", function(e)
		{
			var features = miniMap.queryRenderedFeatures(e.point, {
				layers: ["trackingRectFill"]
			});

			// don't update if we're still hovering the area
			if( ! (self._isCursorOverFeature && features.length > 0) )
			{
				self._isCursorOverFeature = features.length > 0;
				miniMapCanvas.style.cursor = self._isCursorOverFeature ? "move" : "";
			}

			if( self._isDragging )
			{
				var feature = self._repositionTrackingRectFeature(e);

				if( feature )
				{
					miniMap.getSource("trackingRect").setData(feature);
					
					var bounds = self._getFeatureBounds(feature);

					self._parentMap.fitBounds(bounds, {
						duration: 50,
						noMoveStart: true
					});
				}
			}
		});

		miniMap.on("mousedown", function (e)
		{
			if( self._isCursorOverFeature )
			{
				self._isDragging = true;
				self._previousPoint = self._currentPoint;
				self._currentPoint = [e.lngLat.lng, e.lngLat.lat];
			}                               
		}, true);

		miniMap.on("mouseup", function () {
			self._isDragging = false;
		});

		miniMapCanvas.addEventListener("wheel", this._preventDefault);
		miniMapCanvas.addEventListener("mousewheel", this._preventDefault);

		return this._container;
	},

	_repositionTrackingRectFeature: function(e)
	{
		this._previousPoint = this._currentPoint;
		this._currentPoint = [e.lngLat.lng, e.lngLat.lat];

		var source = this._miniMap.getSource("trackingRect");
		var bounds = this._getFeatureBounds(source._data);
		var offset = [
			this._previousPoint[0] - this._currentPoint[0],
			this._previousPoint[1] - this._currentPoint[1]
		];

		return this._getFeatureJSON(bounds, offset);
	},

	_getTrackingRectFeature: function()
	{
		var bounds = this._parentMap.getBounds();

		return this._getFeatureJSON(bounds);
	},

	_getFeatureJSON: function( bounds, offset )
	{
		offset = offset || [0, 0];

		return {
			"type": "Feature",
			"properties": {
				"name": "trackingRect"
			},
			"geometry": {
				"type": "Polygon",
				"coordinates": [[
					[bounds._ne.lng - offset[0], bounds._ne.lat - offset[1]],
					[bounds._sw.lng - offset[0], bounds._ne.lat - offset[1]],
					[bounds._sw.lng - offset[0], bounds._sw.lat - offset[1]],
					[bounds._ne.lng - offset[0], bounds._sw.lat - offset[1]],
					[bounds._ne.lng - offset[0], bounds._ne.lat - offset[1]]
				]]
			}
		};
	},

	_getFeatureBounds: function ( feature )
	{
		var coords = feature.geometry.coordinates[0];
		var bounds = new mapboxgl.LngLatBounds();

		coords.forEach(function(coord){
			bounds.extend(new mapboxgl.LngLat(coord[0], coord[1]));
		});

		return bounds;
	},

	_update: function( e )
	{
		var moveZoom = (e && e.type === "move" && e.originalEvent === void 0);

		if( this._isDragging || moveZoom ) {
			return;
		}

		this._miniMap.getSource("trackingRect")
			.setData(this._getTrackingRectFeature());

		if( typeof this.options.zoomAdjust === "function" ) {
			this.options.zoomAdjust();
		}
	},

	_zoomAdjust: function()
	{
		var miniMap = this._miniMap;
		var parentMap = this._parentMap;
		var miniZoom = parseInt(miniMap.getZoom(), 10);
		var parentZoom = parseInt(parentMap.getZoom(), 10);
		var levels = this.options.zoomLevels;
		var found = false;

		levels.forEach(function(zoom)
		{
			if( ! found && parentZoom >= zoom[0] )
			{
				if( miniZoom >= zoom[1] ) {
					miniMap.setZoom(zoom[2]);
				}

				miniMap.setCenter(parentMap.getCenter());
				found = true;
			}
		});

		if( ! found && miniZoom !== this.options.zoom )
		{
			if( typeof this.options.bounds === "object" ) {
				miniMap.fitBounds(this.options.bounds, {duration: 50});
			}

			miniMap.setZoom(this.options.zoom)
		}
	},

	_createContainer: function ( map )
	{
		var opts = this.options;
		var container = this._container = document.createElement("div");

		container.className = "mapboxgl-ctrl-minimap";
		container.style = "width: " + opts.width + "; height: " + opts.height + ";";
		container.addEventListener("contextmenu", this._preventDefault);

		map.getContainer().appendChild(container);

		if( opts.id !== "" ) {
			container.id = opts.id;
		}

		return container;
	},

	_preventDefault: function(e) {
		e.preventDefault();
	}
});

mapboxgl.Minimap = Minimap;