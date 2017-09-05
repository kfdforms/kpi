import React from 'react';
import PropTypes from 'prop-types';
import reactMixin from 'react-mixin';
import autoBind from 'react-autobind';
import Reflux from 'reflux';
import _ from 'underscore';
import {dataInterface} from '../dataInterface';
import {hashHistory} from 'react-router';
import bem from '../bem';
import stores from '../stores';
import ui from '../ui';
import alertify from 'alertifyjs';

import L from 'leaflet/dist/leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat/dist/leaflet-heat';
import 'leaflet.markercluster/dist/leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

import 'Leaflet.AutoLayers/src/leaflet-autolayers';

import {
  assign,
  t,
  log,
  notify,
} from '../utils';

export class FormMap extends React.Component {
  constructor(props){
    super(props);

    let survey = props.asset.content.survey;
    var hasGeoPoint = false;
    survey.forEach(function(s) {
      if (s.type == 'geopoint')
        hasGeoPoint = true;
    });

    this.state = {
      map: false,
      markers: false,
      heatmap: false,
      markersVisible: true,
      markerMap: false,
      fields: [],
      fieldsToQuery: ['_id', '_geolocation'],
      hasGeoPoint: hasGeoPoint,
      submissions: [],
      error: false,
      showExpandedMap: false
    };

    autoBind(this);    
  }

  componentDidMount () {
    if (!this.state.hasGeoPoint)
      return false;

    var fields = [];
    this.props.asset.content.survey.forEach(function(q){
      if (q.type == 'select_one' || q.type == 'select_multiple') {
        fields.push(q);
      }
    });

    var map = L.map('data-map', {maxZoom: 17});

    var streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        subdomains: ['a', 'b', 'c']
    });
    streets.addTo(map);

    var outdoors = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    });

    var satellite = L.tileLayer('http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      }
    );

    var humanitarian = L.tileLayer('https://tile-{s}.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        attribution: 'Tiles &copy; Humanitarian OpenStreetMap Team &mdash; &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }
    );

    var baseLayers = {
        "OpenStreetMap": streets,
        "OpenTopoMap": outdoors,
        "ESRI World Imagery": satellite,
        "Humanitarian": humanitarian
    };

    L.control.autolayers({baseLayers: baseLayers, selectedOverlays: []}).addTo(map);

    var fq = this.state.fieldsToQuery;
    fields.forEach(function(f){
      if (f.name) {
        fq.push(f.name);
      } else {
        fq.push(f.$autoname);
      }
    });

    this.setState({
        map: map,
        fields: fields,
        fieldsToQuery: fq
      }
    );

    this.requestData(map);
  }

  requestData(map) {
    // TODO: handle forms with over 2000 results
    dataInterface.getSubmissions(this.props.asset.uid, 2000, 0, [], this.state.fieldsToQuery).done((data) => {
      this.setState({submissions: data});
      this.buildMarkers(map);
      this.buildHeatMap(map);
    }).fail((error)=>{
      if (error.responseText)
        this.setState({error: error.responseText, loading: false});
      else if (error.statusText)
        this.setState({error: error.statusText, loading: false});
      else
        this.setState({error: t('Error: could not load data.'), loading: false});
    });
  } 

  buildMarkers(map) {
    var prepPoints = [];
    var icon = L.divIcon({
      className: 'map-marker',
      iconSize: [20, 20],
    });

    var viewby = this.props.viewby || undefined;

    if (viewby) {
      var mapMarkers = this.prepFilteredMarkers(this.state.submissions, this.props.viewby);
      console.log(mapMarkers);
      this.setState({markerMap: mapMarkers});
    } else {
      this.setState({markerMap: false});
    }

    this.state.submissions.forEach(function(item){
      if (item._geolocation && item._geolocation[0] && item._geolocation[1]) {
        if (viewby && mapMarkers != undefined) {
          var itemId = item[viewby];
          icon = L.divIcon({
            className: `map-marker map-marker-${mapMarkers[itemId].id}`,
            iconSize: [20, 20],
          });
        }
        prepPoints.push(L.marker(item._geolocation, {icon: icon, sId: item._id}));
      }
    });

    if (viewby) {
      var markers = L.featureGroup(prepPoints);
    } else {

      var markers = L.markerClusterGroup({maxClusterRadius: 15});
      markers.addLayers(prepPoints);
    }

    markers.on('click', this.launchSubmissionModal).addTo(map);
    map.fitBounds(markers.getBounds());

    this.setState({
        markers: markers
      }
    );
  }

  prepFilteredMarkers (data, viewby) {
    var markerMap = new Object();

    var idcounter = 0;
    data.forEach(function(listitem, i) {
      var m = listitem[viewby];

      if (markerMap[m] == null) {
          markerMap[m] = {count: 1, id: idcounter};
          idcounter++;
      } else {
          markerMap[m]['count'] += 1;
      }
    });

    return markerMap;
  }

  buildHeatMap (map) {
    var heatmapPoints = [];
    this.state.submissions.forEach(function(item){
      if (item._geolocation && item._geolocation[0] && item._geolocation[1])
        heatmapPoints.push([item._geolocation[0], item._geolocation[1], 1]);
    });
    var heatmap = L.heatLayer(heatmapPoints, {
      minOpacity: 0.25,
      radius: 20,
      blur: 8
    });

    if (!this.state.markersVisible) {
      map.addLayer(heatmap);
    }
    this.setState({heatmap: heatmap});
  }

  showMarkers () {
    var map = this.state.map;
    map.addLayer(this.state.markers);
    map.removeLayer(this.state.heatmap);
    this.setState({
        markersVisible: true
      }
    );
  }

  showHeatmap () {
    var map = this.state.map;

    map.addLayer(this.state.heatmap);
    map.removeLayer(this.state.markers);
    this.setState({
        markersVisible: false
      }
    );
  }

  filterMap (evt) {
    let name = evt.target.getAttribute('data-name') || undefined;
    if (name != undefined) {
      hashHistory.push(`/forms/${this.props.asset.uid}/data/map/${name}`);
    } else {
      hashHistory.push(`/forms/${this.props.asset.uid}/data/map`);
    }
  }

  componentWillReceiveProps (nextProps) {
    if (this.props.viewby != undefined) {
      this.setState({markersVisible: true});
    }
    if (this.props.viewby != nextProps.viewby) {
      var map = this.state.map;
      var markers = this.state.markers;
      var heatmap = this.state.heatmap;
      map.removeLayer(markers);
      map.removeLayer(heatmap);
      this.requestData(map);
    }
  }

  launchSubmissionModal (evt) {
    stores.pageState.showModal({
      type: 'submission',
      sid: evt.layer.options.sId,
      asset: this.props.asset
    });
  }

  toggleExpandedMap () {
    stores.pageState.hideDrawerAndHeader(!this.state.showExpandedMap);
    this.setState({
      showExpandedMap: !this.state.showExpandedMap,
    });

    var map = this.state.map;
    setTimeout(function(){ map.invalidateSize()}, 300);
  }

  render () {
    if (!this.state.hasGeoPoint) {
      return (
        <ui.Panel>
          <bem.Loading>
            <bem.Loading__inner>
              {t('This form does not have a "geopoint" field, therefore a map is not available.')}
            </bem.Loading__inner>
          </bem.Loading>
        </ui.Panel>
      );      
    }

    if (this.state.error) {
      return (
        <ui.Panel>
          <bem.Loading>
            <bem.Loading__inner>
              {this.state.error}
            </bem.Loading__inner>
          </bem.Loading>
        </ui.Panel>
        )
    }

    var fields = this.state.fields;
    var label = t('View Options');
    var viewby = this.props.viewby;

    if (viewby) {
      fields.forEach(function(f){
        if(viewby === f.name || viewby === f.$autoname)
          label = `${t('Filtered by:')} ${f.label[0]}`;
      });
    }

    return (
      <bem.FormView m='map'>
        <bem.FormView__mapButton m={'expand'} 
          onClick={this.toggleExpandedMap}
          className={this.state.toggleExpandedMap ? 'active': ''}>
          <i className="k-icon-expand" />
        </bem.FormView__mapButton>
        <bem.FormView__mapButton m={'markers'} 
          onClick={this.showMarkers}
          className={this.state.markersVisible ? 'active': ''}>
          <i className="k-icon-pins" />
        </bem.FormView__mapButton>
        {!viewby && 
          <bem.FormView__mapButton m={'heatmap'} 
            onClick={this.showHeatmap}
            className={!this.state.markersVisible ? 'active': ''}>
            <i className="k-icon-heatmap" />
          </bem.FormView__mapButton>
        }
        <ui.PopoverMenu type='viewby-menu' triggerLabel={label} m={'above'}>
            <bem.PopoverMenu__link key={'all'} onClick={this.filterMap}>
              {t('-- See all data --')}
            </bem.PopoverMenu__link>
            {fields.map((f)=>{
              const name = f.name || f.$autoname;
              return (
                  <bem.PopoverMenu__link data-name={name} key={`f-${name}`} onClick={this.filterMap}>
                    {f.label[0]}
                  </bem.PopoverMenu__link>
                );
            })}
        </ui.PopoverMenu>
        {this.state.markerMap && this.state.markersVisible && 
          <bem.FormView__mapList>
            {Object.keys(this.state.markerMap).map((m, i)=>{
              return (
                  <div key={`m-${i}`} className="map-marker-item">
                    <span className={`map-marker map-marker-${this.state.markerMap[m].id}`}>
                      {this.state.markerMap[m].count}
                    </span>
                    <span className={`map-marker-label`}>
                      {m}
                    </span>
                  </div>
                );
            })}
          </bem.FormView__mapList>
        }
        {!this.state.markers && !this.state.heatmap && 
          <bem.Loading>
            <bem.Loading__inner>
              <i />
            </bem.Loading__inner>
          </bem.Loading>
        }
        <div id="data-map"></div>
      </bem.FormView>
      );
  }
};

reactMixin(FormMap.prototype, Reflux.ListenerMixin);

export default FormMap;
