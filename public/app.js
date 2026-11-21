import {escapeHTML as e, distanceMiles, scheduleStatus, filterPlaces, directionsURL, isFoodVenue, isRoadside, businessListingURL, shouldLocateOnStart, preferredMapStyle} from './logic.js';
import {initCityGuide, nearestCity, applyCity, routeURL, writeRouteURL} from './city-guide.js';
import {addVectorMap} from './vector-map.js';
import {placeFromFeature, createVenueMatcher, getCachedPlaces, saveVenues, deleteCachedPlaces} from './venue-data.js';
import {createViewportDiscovery} from './us-viewport.js';
import {usRegionAt, usRegionsInBounds, usRegionView} from './us-geography.js';
import {loadNationalIndex} from './national-index.js';
import {loadVenueAtlas, atlasBuckets} from './national-venues.js';
import {mapBounds, intersects, pointFilter, markerGroups} from './atlas-view.js';
import {addStreetMap} from './street-map.js';
import {createOcean} from './ocean.js';
import {initRatings,ratingSummaryHTML,ratingPanelHTML,getRating} from './ratings.js';

const $ = id => document.getElementById(id);
const icon = (name, cls='') => {
  const shapes = {
    shower:'<path d="M4 21V7a4 4 0 0 1 8 0v1m-3 4a4 4 0 0 1 8 0Zm1 4-1 2m5-2-1 2m5-2-1 2"/>',
    phone:'<path d="M5 3h4l2 5-3 2a14 14 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2Z"/>',
    fuel:'<path d="M4 21V5a1 1 0 0 1 1-1h8v17M3 21h12M5 7h6v5H5zm8 6h2c2 0 1 5 3 5 1 0 2-1 2-3v-5l-4-4"/>',
    bookmark:'<path d="M6 4h12v17l-6-4-6 4z"/>',
    drive:'<path d="m3 13 2-6h14l2 6v5H3zm0 0h18M5 18v2m14-2v2m-13-5h2m8 0h2"/>',
    pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    walk:'<circle cx="14" cy="4" r="2"/><path d="m7 11 4-4 4 3 4 1M10 16l-3 6m5-10-2 4 5 2 2 4M11 7l1 5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    share:'<path d="M12 16V3m-5 5 5-5 5 5M5 14v7h14v-7"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    access:'<circle cx="12" cy="4" r="2"/><path d="M11 8v6h6l3 6M11 10l5 1M8 11a6 6 0 1 0 7 9"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    source:'<path d="M14 3h7v7m-1-6-10 10M10 4H4v16h16v-6"/>',
    toilet:'<path d="M5 3h6v8H5zM5 11h15c0 5-3 7-7 7H9c-3 0-4-3-4-7Zm5 7v3h6v-4M18 8v3"/>',
  };
  return `<svg class="ui-icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.pin}</svg>`;
};

let places = [];
let city;
let cityGuide;
let cityRevision=0;
let positionAccuracy=0;
let resultRanks=new Map();
let placeIndex=new Map();
let visibleLimit=60;
let nationalIndex;
let venueAtlas;
let catalogRequest;
let catalogFailed=false;
let areaTargets=[];
const DETAIL_ATLAS_ZOOM=9;
let indexRequest;
let currentGuide = [];
let viewport;
let discovery;
let refreshTimer;
let atlasLayer;
let pendingSpot;
let navigating = 0;
let panRevision = 0;
const guides = new Map();
const savedPlaces = new Map();
const converted = new WeakMap();
let mapObserver;
let meta = {};
let map;
let markerLayer;
let userMarker;
let userCircle;
let position = null;
let selectedId = null;
let savedOnly = false;
let locating = false;
let filters = new Set();
let markers = new Map();
let view = 'map';
let toastTimeout;
let lastDetailTrigger;
let saved = new Set();
try {
  const value = JSON.parse(localStorage.getItem('in-a-pinch:saved') || '[]');
  if (Array.isArray(value)) saved = new Set(value.filter(x => typeof x === 'string').slice(0,500));
} catch { /* The map also works when browser storage is unavailable. */ }

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('toast').classList.remove('visible'); $('toast').hidden = true; }, 4300);
}

function guideFor(place) {
  return cityGuide?.cities.find(c=>c.id===place.cityId) || city;
}
const accessLabel = p => ({public:'Free & public',paid:'Admission required',customers:'Purchase likely',unknown:'Check access'})[p.access] || 'Check access';
const accessClass = p => p.access === 'public' ? 'free' : p.access === 'paid' ? 'paid' : 'unknown';
const shortDistance = p => {
  if (!position) return '';
  const mi = distanceMiles(position,p);
  return mi < .1 ? `${Math.max(20,Math.round(mi*5280/20)*20)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString()} mi`;
};

function getResults() {
  const results = filterPlaces(savedOnly ? [...savedPlaces.values()] : places,{query:$('search-input').value,filters,savedOnly,saved});
  const sort = $('sort-select').value;
  if (sort === 'name') results.sort((a,b) => a.name.localeCompare(b.name));
  else if (sort === 'rating') results.sort((a,b) => (getRating(b.id).average ?? -1)-(getRating(a.id).average ?? -1) || getRating(b.id).count-getRating(a.id).count || a.name.localeCompare(b.name));
  else if (sort === 'distance' && position) results.sort((a,b) => distanceMiles(position,a)-distanceMiles(position,b));
  else results.sort((a,b) => (a.access === 'public' ? 0:1)-(b.access === 'public' ? 0:1) || (a.priority ?? 50)-(b.priority ?? 50) || a.name.localeCompare(b.name));
  return results;
}

function render() {
  placeIndex=new Map([...savedPlaces, ...places.map(p=>[p.id,p])]);
  const areaCells = overviewCells();
  const results = areaCells.length ? [] : getResults();
  resultRanks=new Map(results.map((p,i)=>[p.id,i+1]));
  $('result-count').textContent = `${results.length.toLocaleString()} ${results.length === 1 ? 'mapped stop' : 'mapped stops'}`;
  if ($('map-count')) $('map-count').textContent = `${results.length.toLocaleString()} ${savedOnly ? 'saved' : 'in view'}`;
  if ($('total-count')) $('total-count').textContent = `${places.length} mapped stops`;
  document.querySelectorAll('#filters [data-filter]').forEach(button => {
    const active = button.dataset.filter === 'all' ? filters.size === 0 : filters.has(button.dataset.filter);
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  if ($('saved-btn')) {
    $('saved-btn').classList.toggle('active',savedOnly);
    $('saved-btn').setAttribute('aria-pressed',String(savedOnly));
    $('saved-btn').setAttribute('aria-label',`${savedOnly?'Show all places':'Show saved places'}${saved.size?` (${saved.size} saved)`:''}`);
    $('saved-btn').innerHTML = `${icon('bookmark')}${saved.size ? `<span class="saved-count">${saved.size}</span>`:''}`;
  }
  if (selectedId && !areaCells.length && !results.some(p => p.id === selectedId)) closeDetail(false);
  $('result-list').innerHTML = results.length ? results.slice(0,visibleLimit).map(p => {
    const status = scheduleStatus(p);
    return `<article class="result-card ${p.id === selectedId ? 'selected':''}" data-place="${e(p.id)}">
      <div class="card-topline"><span class="place-category"><b class="result-rank">${resultRanks.get(p.id)}</b>${e(p.category)} <span class="category-separator">·</span> ${e(p.neighborhood || p.locality || p.state || 'United States')}</span><button class="save-btn ${saved.has(p.id)?'is-saved':''}" data-save="${e(p.id)}" aria-label="${saved.has(p.id)?'Unsave':'Save'} ${e(p.name)}" aria-pressed="${saved.has(p.id)}">${icon('bookmark')}</button></div>
      <button class="card-main" data-select="${e(p.id)}" aria-label="View ${e(p.name)} details"><h3 class="place-name">${e(p.name)}</h3><p class="place-address">${e(p.address)}</p></button>
      <div class="card-tags"><span class="tag tag-${accessClass(p)}">${e(accessLabel(p))}</span>${p.bathroomConfirmed===false?'<span class="tag tag-unconfirmed">Bathroom unconfirmed</span>':''}${p.accessible === true ? `<span class="tag tag-accessible">${icon('access')}Accessible WC</span>`:''}</div>
      ${isFoodVenue(p)||isRoadside(p)?`<a class="business-listing-link" href="${e(businessListingURL(p,guideFor(p)))}" target="_blank" rel="noopener" aria-label="Find ${e(p.name)} on Google Maps">${icon('source')}View on Google Maps</a>`:''}
      ${p.showers===true?'<span class="tag tag-showers">Showers listed'+(p.showerCount?' · '+e(p.showerCount):'')+'</span>':''}
      ${p.dynamicListing?'<p class="discovered-venue-note">Bathroom access unverified</p>':ratingSummaryHTML(p.id)}
      <div class="card-bottom"><span class="hours-label status-${status.state}">${icon('clock')}${e(status.label)}</span>${position?`<span class="distance-label" title="Straight-line distance, not a walking route">${shortDistance(p)} away</span>`:`<button class="card-detail-link" data-select="${e(p.id)}" aria-label="More details about ${e(p.name)}">Details</button>`}</div>
    </article>`;
  }).join('')+(results.length>visibleLimit?`<button type="button" class="load-more-venues" data-more-venues>Show 60 more places <span>${Math.min(visibleLimit,results.length)} of ${results.length}</span></button>`:'') : `<div class="empty-state">${icon(savedOnly?'bookmark':'pin')}<h3>${savedOnly ? 'No saved stops match.' : !places.length && !filters.size && !$('search-input').value ? 'Stops in this area' : 'No matching stops'}</h3><p>${savedOnly ? 'Tap a bookmark on any bathroom to save it on this device. Saved places still follow your search and filters.' : filters.has('open') ? 'Only published restroom hours qualify. Unknown hours are excluded. Try removing a filter or search term.' : filters.has('accessible') ? 'This filter only includes specifically documented accessible restrooms. Other places may be accessible; their details are not confirmed.' : !places.length && !filters.size && !$('search-input').value ? e(areaMessage()) : 'Try another place name or clear a filter.'}</p><button class="secondary-action" data-clear>Show all bathrooms</button></div>`;
  if(areaCells.length){renderAreaGroups(areaCells);}else{updateMarkers(results);}
  if(viewport)$('area-status').textContent=areaMessage();
  if ($('filter-note')) $('filter-note').textContent = areaCells.length ? 'Select an area to see individual stops.' : filters.has('open') ? `Published hours in each stop’s local time` : position ? 'Distances are straight-line estimates, not walking routes.' : 'Public facilities first. Tap a stop for access details.';
}

function pinIcon(place) {
  const access=place.access==='public'?'public':place.access==='paid'?'paid':'unknown';
  const rank=resultRanks.get(place.id)||'';
  return window.L.divIcon({className:'pin-wrapper',html:`<div class="map-pin ${access} ${selectedId===place.id?'selected':''}"><span class="pin-pictogram">${icon(placeIcon(place))}</span><span class="pin-rank">${rank}</span><span class="pin-access-mark" aria-hidden="true">${access==='public'?'✓':access==='paid'?'$':'?'}</span></div>`,iconSize:[44,54],iconAnchor:[22,49],tooltipAnchor:[0,-44]});
}

function updateMarkers(results) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  atlasLayer.clearLayers();
  markers.clear();
  const pins = [];
  for (const group of markerGroups(results, map)) {
    const {count, place} = group;
    const latlng = [group.sumLat / count, group.sumLng / count];
    if (count > 1) {
      const label = count.toLocaleString() + ' stops · zoom in';
      const marker = window.L.marker(latlng, {icon:window.L.divIcon({
        html:`<span>${count.toLocaleString()}</span>`, className:'atlas-cluster', iconSize:[46,46]
      }), title:label, alt:label});
      marker.on('click', () => {
        if (map.getZoom() < map.getMaxZoom()) {
          const bounds = [[group.south, group.west], [group.north, group.east]];
          map.fitBounds(bounds, {maxZoom:Math.min(18, map.getZoom() + 4), padding:[40,40]});
        }
      });
      marker.addTo(atlasLayer);
      continue;
    }
    const marker = window.L.marker(latlng, {icon:pinIcon(place), title:place.name, alt:place.name, keyboard:true, riseOnHover:true, zIndexOffset:selectedId===place.id ? 500 : 0});
    marker.bindTooltip(`<strong>${e(place.name)}</strong><span>${e(accessLabel(place))}</span>`, {className:'place-tooltip',direction:'top',offset:[0,-4],opacity:1});
    marker.on('click', () => openDetail(place.id, {fromMap:true}));
    pins.push(marker);
    markers.set(place.id, marker);
  }
  if (markerLayer.addLayers) markerLayer.addLayers(pins);
  else for (const pin of pins) markerLayer.addLayer(pin);
}

async function initializeMap() {
  if (!window.L) {
    $('map-status').hidden = false;
    $('map-status').textContent = 'The map could not load. All bathroom details and directions are available in the list.';
    setView('list');
    return;
  }
  const L = window.L;
  map = L.map('map',{zoomControl:false,minZoom:2,maxZoom:19,zoomSnap:.5,worldCopyJump:true,scrollWheelZoom:true,attributionControl:true});
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a>');
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.scale({imperial:true,metric:false,position:'bottomleft',maxWidth:100}).addTo(map);
  homeView();
  try { addVectorMap(map, L, city, $('map-status')); }
  catch { addStreetMap(map, L, $('map-status')); }
  markerLayer = L.markerClusterGroup ? L.markerClusterGroup({maxClusterRadius:38,disableClusteringAtZoom:17,showCoverageOnHover:false,spiderfyOnMaxZoom:true,iconCreateFunction:cluster=>L.divIcon({html:`<span>${cluster.getChildCount()}</span>`,className:'pin-cluster',iconSize:[44,44]})}) : L.layerGroup();
  markerLayer.addTo(map);
  atlasLayer = L.layerGroup().addTo(map);
  map.on('dragstart', () => {panRevision++; pendingSpot=null;});
  map.on('movestart', () => {clearTimeout(refreshTimer); discovery?.cancel(); viewport=null;});
  map.on('moveend resize', () => {
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(refreshViewport,120);
  });
  refreshViewport();
  mapObserver?.disconnect();
  mapObserver=new ResizeObserver(()=>map?.invalidateSize({pan:false}));
  mapObserver.observe($('map'));
}

function placeIcon(place) {
  return place.showers === true ? 'shower' : isRoadside(place) ? 'fuel' : 'toilet';
}
function roadsidePhone(place) {
  if (!isRoadside(place) || typeof place.phone !== 'string') return null;
  const text = place.phone.trim();
  if (!/^[+()\d.\s-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g,'');
  const number = /^1?[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? '+1' + digits.slice(-10) : null;
  return number ? {href:'tel:' + number, label:text} : null;
}
function showerDescription(place) {
  if (place.showers !== true) return place.showers === false ? 'The source lists no showers here.' : 'Shower availability is unknown.';
  const note = place.showerNote?.trim() || '';
  const count = Number(place.showerCount);
  if (!Number.isInteger(count) || count < 1) return note || 'Showers listed. Check fees and availability with the operator.';
  if (new RegExp('\\b' + count + '\\s+(?:private |accessible )?showers?\\b','i').test(note)) return note;
  const guidance = note.replace(/^Showers listed(?: by the operator)?\.\s*/i,'');
  return count + (count === 1 ? ' shower listed. ' : ' showers listed. ') + (guidance || 'Check fees and availability with the operator.');
}

function renderDetails(place) {
  const phone = roadsidePhone(place);
  const status = scheduleStatus(place);
  const coordinateText = place.coordinateAccuracy === 'approximate' ? 'This pin is approximate. Check the street address before setting out.' : place.coordinateAccuracy === 'restroom' ? 'Pin marks a mapped restroom location. Follow signs for the entrance.' : 'Pin marks the facility area, not a surveyed restroom entrance. Follow signs or ask staff on arrival.';
  $('detail-content').innerHTML = `<div class="detail-header"><span class="place-category">${e(place.category)} · ${e(place.neighborhood || place.locality || place.state || 'United States')}</span><div class="detail-symbol">${icon(placeIcon(place))}</div><h2 id="detail-title" class="detail-title">${e(place.name)}</h2><p class="place-address">${icon('pin')}${e(place.address)}</p><div class="card-tags"><span class="tag tag-${accessClass(place)}">${e(accessLabel(place))}</span><span class="tag tag-${status.state}">${e(status.label)}</span></div></div>
    <div class="detail-actions">${isFoodVenue(place)||isRoadside(place)?`<a class="business-listing-action" href="${e(businessListingURL(place,guideFor(place)))}" target="_blank" rel="noopener">${icon('source')}View ${e(place.name)} on Google Maps</a>`:''}<a class="primary-action" href="${e(directionsURL(place))}" target="_blank" rel="noopener">${icon(isRoadside(place)?'drive':'walk')}${isRoadside(place)?'Driving directions':'Walking directions'}</a><div class="detail-secondary-actions">${phone?`<a class="secondary-action" href="${e(phone.href)}" aria-label="Call ${e(place.name)} at ${e(phone.label)}">${icon('phone')}Call ${e(phone.label)}</a>`:''}<button class="secondary-action ${saved.has(place.id)?'is-saved':''}" data-save="${e(place.id)}">${icon('bookmark')}${saved.has(place.id)?'Saved':'Save this stop'}</button><button class="secondary-action" data-share="${e(place.id)}">${icon('share')}Share</button></div><p class="directions-note">Opens Google Maps. ${position?`${shortDistance(place)} away in a straight line.`:'Your starting point is selected in Maps.'}</p></div>
    ${place.dynamicListing?'<section class="detail-section"><h3>About this listing</h3><p>See the source below for the location record. Bathroom access and hours may require a call or a visit.</p></section>':ratingPanelHTML(place.id)}
    <section class="detail-section"><h3>Before you go</h3>${place.bathroomConfirmed===false?'<p class="detail-unconfirmed">Venue listing · Bathroom not yet confirmed</p>':''}<p>${e(place.note)}</p><dl class="detail-meta"><div><dt>Access</dt><dd>${e(place.accessNote || accessLabel(place))}</dd></div><div><dt>Restroom hours</dt><dd>${e(place.hours?.label || 'Not confirmed. Check the source or ask on arrival.')}</dd></div>${place.venueHours?`<div><dt>Venue hours</dt><dd>${e(place.venueHours)}<small>Venue hours do not confirm restroom availability.</small></dd></div>`:''}<div><dt>Wheelchair access</dt><dd>${e(place.accessibilityNote || (place.accessible === true ? 'Accessible restrooms listed by the source.' : 'Restroom accessibility not confirmed.'))}</dd></div>${isRoadside(place) || place.showers===true ? `<div><dt>Showers</dt><dd>${e(showerDescription(place))}</dd></div>`:''}${place.showers===true && Number.isInteger(place.accessibleShowerCount) && place.accessibleShowerCount>=0?`<div><dt>Accessible showers</dt><dd>${place.accessibleShowerCount} listed by the operator</dd></div>`:''}<div><dt>Changing table</dt><dd>${place.changingTable === true ? 'Listed by the source.' : 'Not confirmed.'}</dd></div></dl></section>
    <section class="detail-section location-accuracy">${icon('info')}<p>${e(coordinateText)} ${place.hours?.scope === 'restroom' ? `Schedule uses the facility’s local time. Temporary closures are not monitored.` : ''}</p></section>
    <section class="detail-section"><h3>From the source</h3><p class="source-intro">${place.dynamicListing && place.evidenceType!=='vector-poi'?'Source directory entry. Check with the operator for restroom availability and current access.':place.evidenceType==='osm-venue'?'OpenStreetMap venue listing. Bathroom availability and purchase rules have not been confirmed by the venue.':place.evidenceType==='osm'?'Community-mapped listing. Access and facilities may need confirmation.':place.evidenceType==='vector-poi'?'A community-mapped point of interest. A business pin does not establish bathroom access; mapped restroom points may have unknown public access.':place.evidenceType==='venue-lead'?'Venue reference only. This source has not yet been verified for bathroom availability.':'Published facility information. Check with the operator for changes.'}</p><div class="source-links">${place.sources.map(source=>`<a class="source-link" href="${e(source.url)}" target="_blank" rel="noopener">${e(source.label)}${icon('source')}</a>`).join('')}</div><p class="source-checked">Directory reference: ${e(place.checkedLabel || meta.checkedLabel || 'November 2026')}. Community ratings describe past visits; current availability is not monitored.</p></section>`;
}

function openDetail(id,{fromMap=false,fromLink=false}={}) {
  const place=placeIndex.get(id);
  if(!place)return;
  lastDetailTrigger=document.activeElement;
  const previous=selectedId;
  pendingSpot=null;
  selectedId=id;
  $('detail-panel').hidden=false;
  $('detail-panel').classList.add('is-open');
  $('detail-panel').setAttribute('aria-hidden','false');
  $('detail-panel').setAttribute('aria-labelledby','detail-title');
  $('app').classList.add('detail-open');
  renderDetails(place);
  if(fromMap)setView('map');
  document.querySelectorAll('.result-card').forEach(card=>card.classList.toggle('selected',card.dataset.place===id));
  for(const key of [previous,id]){const m=markers.get(key), p=placeIndex.get(key);if(m&&p){m.setIcon(pinIcon(p));m.setZIndexOffset(key===id?500:0);}}
  if(map && !fromMap){
    const zoom=Math.max(map.getZoom(),16);
    map.setView([place.lat,place.lng],zoom,{animate:false});
    if(window.innerWidth>1000)map.panBy([180,0],{animate:false});
  }
  writeRouteURL(spotURL(place));
  $('detail-panel').scrollTop=0;
  if(!fromLink)$('detail-close').focus({preventScroll:true});
}

function closeDetail(restoreFocus=true) {
  const previous=selectedId;
  selectedId=null;
  $('detail-panel').hidden=true;
  $('detail-panel').classList.remove('is-open');
  $('detail-panel').setAttribute('aria-hidden','true');
  $('app').classList.remove('detail-open');
  document.querySelectorAll('.result-card.selected').forEach(c=>c.classList.remove('selected'));
  if(markers.has(previous) && placeIndex.has(previous))markers.get(previous).setIcon(pinIcon(placeIndex.get(previous)));
  if(previous && routeURL().searchParams.get('spot')===previous){const url=routeURL();url.searchParams.delete('spot');url.searchParams.delete('near');writeRouteURL(url);}
  if(restoreFocus && lastDetailTrigger?.isConnected)lastDetailTrigger.focus({preventScroll:true});
}

function toggleSaved(id) {
  const inDetail=$('detail-content').contains(document.activeElement);
  if(saved.has(id)){
    saved.delete(id);savedPlaces.delete(id);void deleteCachedPlaces([id]);
  }else{
    const place=placeIndex.get(id);
    if(!place)return;
    saved.add(id);savedPlaces.set(id,place);void saveVenues([place]);
  }
  let persisted=true;
  try{localStorage.setItem('in-a-pinch:saved',JSON.stringify([...saved]));}catch{persisted=false;}
  render();
  if(selectedId===id)renderDetails(placeIndex.get(id));
  const replacement=(inDetail?$('detail-content'):$('result-list')).querySelector(`[data-save="${CSS.escape(id)}"]`);
  if(replacement)replacement.focus({preventScroll:true});else $('saved-btn').focus({preventScroll:true});
  toast(saved.has(id)?persisted?'Saved on this device.':'Saved for this session. Browser storage is unavailable.':'Removed from your saved spots.');
}

function spotURL(place) {
  const url=routeURL();
  url.searchParams.set('city',place.cityId || 'us');
  url.searchParams.set('spot',place.id);
  url.searchParams.set('near',place.lat + ',' + place.lng);
  return url;
}

async function sharePlace(id) {
  const place=placeIndex.get(id);
  const url=location.protocol === 'file:' ? new URL(businessListingURL(place,guideFor(place))) : spotURL(place);
  try{
    if(navigator.share)await navigator.share({title:`${place.name} · IN A PINCH`,text:'when you gotta go, you gotta go',url:url.href});
    else {await navigator.clipboard.writeText(url.href);toast('Bathroom link copied.');}
  }catch(error){
    if(error.name==='AbortError')return;
    toast(location.protocol === 'file:' ? 'Use the Google Maps link in the listing to share this stop.' : 'Copy the address from your browser to share this stop.');
  }
}

function setView(next) {
  view=next;
  $('app').dataset.view=next;
  $('app').classList.toggle('view-list',next==='list');
  $('app').classList.toggle('view-map',next==='map');
  $('map-view-btn').classList.toggle('active',next==='map');
  $('list-view-btn').classList.toggle('active',next==='list');
  $('map-view-btn').setAttribute('aria-pressed',String(next==='map'));
  $('list-view-btn').setAttribute('aria-pressed',String(next==='list'));
  if(map)requestAnimationFrame(()=>map.invalidateSize({pan:false}));
}

function drawPosition({focus=false}={}) {
  if(!map||!position)return;
  if(userMarker)map.removeLayer(userMarker);
  if(userCircle)map.removeLayer(userCircle);
  userMarker=null;userCircle=null;
  if(!usRegionAt(position.lat,position.lng))return;
  userMarker=window.L.marker([position.lat,position.lng],{icon:window.L.divIcon({className:'user-location-marker',html:'<span class="user-location-halo"></span><span class="user-location-dot"></span>',iconSize:[24,24],iconAnchor:[12,12]}),title:'Your approximate location',zIndexOffset:1500}).addTo(map);
  userMarker.bindTooltip('You are here',{direction:'top',offset:[0,-13]});
  userCircle=window.L.circle([position.lat,position.lng],{radius:Math.max(10,Math.min(positionAccuracy,2000)),color:'#40dceb',fillOpacity:.08,weight:1,interactive:false}).addTo(map);
  if(focus)map.setView([position.lat,position.lng],16,{animate:false});
}

function locate({auto=false}={}) {
  if(locating)return;
  if(!navigator.geolocation){$('location-status').textContent='Location unavailable. Pan the U.S. map or choose a destination.';return;}
  const revision=cityRevision, initialPan=panRevision;
  locating=true;$('locate-btn').disabled=true;$('locate-btn').setAttribute('aria-busy','true');
  $('location-status').textContent=auto?'Finding your city and nearby stops…':'Waiting for your location…';
  const finish=()=>{locating=false;$('locate-btn').disabled=false;$('locate-btn').removeAttribute('aria-busy');};
  navigator.geolocation.getCurrentPosition(async result=>{
    position={lat:result.coords.latitude,lng:result.coords.longitude};positionAccuracy=result.coords.accuracy;
    // A slow permission prompt must not override a city chosen in the meantime.
    if(auto&&(revision!==cityRevision||initialPan!==panRevision)){finish();render();drawPosition();return;}
    try{
      const region=usRegionAt(position.lat,position.lng);
      if(!region){
        $('location-status').textContent='Your location is outside the U.S. map. Choose a state or city to explore.';
        return;
      }
      const closest=nearestCity(position);
      const guide=closest && distanceMiles(position,closest)<=12 ? closest.id : 'us';
      if(guide!==city.id)await cityGuide.select(guide);
      $('sort-select').value='distance';render();drawPosition({focus:true});
      $('location-status').textContent=`Near you · ${region.name} · accuracy about ${Math.max(1,Math.round(positionAccuracy*3.28084))} ft`;
    }catch{toast('Unable to load this location. Pan the map or choose a destination.');}
    finally{finish();}
  },error=>{
    finish();
    if(auto&&(revision!==cityRevision||initialPan!==panRevision))return;
    const message=error.code===1?'Location is off. Choose a city or pan the U.S. map.':error.code===3?'Location timed out. Choose a city, or tap Find near me to retry.':'Location couldn’t be found. You can still pan the U.S. map.';
    $('location-status').textContent=message;
    if($('sort-select').value==='distance')$('sort-select').value='recommended';
    if(!auto)toast(message);
  },{enableHighAccuracy:true,timeout:12000,maximumAge:120000});
}

function initMapStyle() {
  let remembered='wireframe';try{remembered=(localStorage.getItem('in-a-pinch:v4:map-style') || localStorage.getItem('in-a-pinch:v3:map-style'))||remembered;}catch{}
  function setStyle(value){
    const style=preferredMapStyle(value);document.body.dataset.mapStyle=style;
    for(const button of document.querySelectorAll('[data-map-style-option]'))button.setAttribute('aria-pressed',String(button.dataset.mapStyleOption===style));
    try{localStorage.setItem('in-a-pinch:v4:map-style',style);}catch{}
    document.dispatchEvent(new CustomEvent('mapstylechange',{detail:style}));
  }
  setStyle(remembered);
  document.querySelectorAll('[data-map-style-option]').forEach(button=>button.addEventListener('click',()=>setStyle(button.dataset.mapStyleOption)));
}

function clearFilters() {
  filters.clear();savedOnly=false;$('search-input').value='';closeDetail(false);render();
}

function bindEvents() {
  $('search-input').addEventListener('input',()=>{visibleLimit=60;render();});
  $('filters').addEventListener('click',event=>{
    const button=event.target.closest('[data-filter]');if(!button)return;
    visibleLimit=60;const value=button.dataset.filter;
    if(value==='all')filters.clear();else{if(value==='free')filters.delete('purchase');if(value==='purchase')filters.delete('free');filters.has(value)?filters.delete(value):filters.add(value);}
    render();
  });
  $('sort-select').addEventListener('change',()=>{if($('sort-select').value==='distance'&&!position)locate();else render();});
  $('saved-btn')?.addEventListener('click',async()=>{savedOnly=!savedOnly;render();if(savedOnly){setView('list');await restoreSaved();render();}});
  $('locate-btn').addEventListener('click',locate);
  $('reset-map-btn').addEventListener('click',()=>{pendingSpot=null;closeDetail(false);homeView();setView('map');});
  $('map-view-btn').addEventListener('click',()=>setView('map'));
  $('list-view-btn').addEventListener('click',()=>setView('list'));
  $('detail-close').addEventListener('click',()=>closeDetail());
  $('about-btn').addEventListener('click',()=>{$('about-dialog').showModal();});
  $('about-close').addEventListener('click',()=>{$('about-dialog').close();});
  $('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')){const r=$('about-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('about-dialog').close();}});
  $('area-retry').addEventListener('click',()=>{if(!nationalIndex || nationalIndex.partial)void startIndex();if(!venueAtlas)void startAtlas();refreshViewport();});
  $('state-jump').addEventListener('change',async event=>{
    const anchor=usRegionView(event.target.value);
    event.target.value='';
    if(!anchor||!cityGuide)return;
    pendingSpot=null;panRevision++;
    await cityGuide.select('us');
    setView('map');map?.setView([anchor.lat,anchor.lng],anchor.zoom,{animate:false});
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-national-overview]')){pendingSpot=null;panRevision++;setView('map');void cityGuide?.select('us').catch(()=>toast('Unable to open the atlas.'));return;}
    if(event.target.closest('button[data-city]')){panRevision++;pendingSpot=null;}
    const areaButton=event.target.closest('[data-atlas-target]');
    if(areaButton){const area=areaTargets[Number(areaButton.dataset.atlasTarget)];if(area)focusArea(area);return;}
    if(event.target.closest('[data-more-venues]')){visibleLimit+=60;render();return;}
    if(event.target.closest('[data-discover-venues]')){setView('map');if(map)map.setZoom(Math.max(15.5,map.getZoom()));toast('Pan the map to see nearby stops.');return;}
    const saveButton=event.target.closest('[data-save]');if(saveButton){toggleSaved(saveButton.dataset.save);return;}
    const selectButton=event.target.closest('[data-select]');if(selectButton){openDetail(selectButton.dataset.select);return;}
    const shareButton=event.target.closest('[data-share]');if(shareButton){sharePlace(shareButton.dataset.share);return;}
    if(event.target.closest('[data-clear]'))clearFilters();
    const card=event.target.closest('.result-card');
    if(card && !event.target.closest('button,a,input,select'))openDetail(card.dataset.place);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && selectedId && !$('about-dialog').open && !$('cities-dialog').open)closeDetail();
    if(event.key==='/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !$('about-dialog').open && !$('cities-dialog').open){event.preventDefault();$('search-input').focus();}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&city){applyCity(city);render();if(selectedId)renderDetails(placeIndex.get(selectedId));}});
  setInterval(()=>{
    if(!city || document.hidden || $('result-list').contains(document.activeElement) || $('detail-panel').contains(document.activeElement))return;
    applyCity(city);render();if(selectedId)renderDetails(placeIndex.get(selectedId));
  },60000);
}


function homeView() {
  if(!map || !city)return;
  if(city.id==='us'){
    map.fitBounds([[24.5,-124.8],[49.5,-66.8]],{padding:[16,24],animate:false});
  }else{
    map.setView([city.lat,city.lng],14,{animate:false});
  }
}

function startAtlas() {
  if(catalogRequest)return catalogRequest;
  catalogFailed=false;
  catalogRequest=loadVenueAtlas().then(catalog=>{
    venueAtlas=catalog;
    if(viewport){readAtlasArea(viewport);applyViewport(viewport);}
  }).catch(()=>{
    catalogFailed=true;catalogRequest=null;
    if(viewport)applyViewport(viewport);
  });
  return catalogRequest;
}

function readAtlasArea(area) {
  if(!venueAtlas || !area.regions.length)return;
  const summary=venueAtlas.overview(area.bounds,false);
  const dense=area.zoom<14 && summary.reduce((sum,cell)=>sum+cell.count,0)>12000;
  if(area.zoom<DETAIL_ATLAS_ZOOM || dense){
    area.cells=summary;
    return;
  }
  area.atlasLoading=true;
  void venueAtlas.query(area.bounds).then(result=>{
    if(viewport!==area)return;
    area.atlasPlaces=result.records;
    area.atlasFailed=result.partial;
  }).catch(()=>{area.atlasFailed=true;}).finally(()=>{
    if(viewport!==area)return;
    area.atlasLoading=false;
    applyViewport(area);
  });
}

function overviewCells() {
  if(!map || !viewport?.cells?.length || savedOnly || $('search-input').value.trim())return [];
  if(filters.size===0)return viewport.cells;
  if(filters.size===1 && filters.has('roadside')){
    viewport.roadCells ??= venueAtlas.overview(viewport.bounds,'roadside');
    return viewport.roadCells;
  }
  if(filters.size===1 && filters.has('confirmed')){
    viewport.toiletCells ??= venueAtlas.overview(viewport.bounds,true);
    return viewport.toiletCells;
  }
  return [];
}

function focusArea(area) {
  pendingSpot=null;panRevision++;
  setView('map');
  map.setView([area.lat,area.lng],Math.min(14,Math.max(9,map.getZoom()+4)),{animate:false});
}

function renderAreaGroups(cells) {
  markerLayer.clearLayers();atlasLayer.clearLayers();markers.clear();
  const regions=new Map();
  for(const cell of cells){
    let region=regions.get(cell.state);
    if(!region){region={count:0,anchor:cell};regions.set(cell.state,region);}
    region.count+=cell.count;
    if(cell.count>region.anchor.count)region.anchor=cell;
  }
  const list=[...regions.entries()].sort((a,b)=>b[1].count-a[1].count);
  const noun=filters.has('confirmed')?'mapped restrooms':filters.has('roadside')?'gas & highway stops':'mapped stops';
  areaTargets=list.map(([,r])=>r.anchor);
  $('result-count').textContent='Explore by area';
  const count=cells.reduce((sum,c)=>sum+c.count,0).toLocaleString();
  $('total-count').textContent=count+' '+noun+' in these map areas';
  $('map-count').textContent=count+' '+noun+' in these areas';
  const labels=new Map(viewport.regions.map(r=>[r.code,r.name]));
  $('result-list').innerHTML=list.map(([state,r],index)=>`<article class="result-card"><button type="button" class="card-main atlas-area-link" data-atlas-target="${index}"><span><strong class="place-name">${e(labels.get(state)||state)}</strong><span class="place-address">${r.count.toLocaleString()} ${noun} in these map areas</span></span><span aria-hidden="true">＋</span></button></article>`).join('');
  for(const group of atlasBuckets(cells,map)){
    const label=group.count.toLocaleString()+' '+noun+' · zoom in';
    const marker=window.L.marker([group.lat,group.lng],{title:label,alt:label,
      icon:window.L.divIcon({className:'atlas-cluster',html:'<span>'+Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(group.count)+'</span>',iconSize:[46,46]})});
    marker.bindTooltip(e(label));
    marker.on('click',()=>focusArea(group.anchor));
    marker.addTo(atlasLayer);
  }
}

let indexFailed = false;
async function startIndex() {
  if(indexRequest)return indexRequest;
  indexFailed=false;
  indexRequest=loadNationalIndex().then(index=>{
    nationalIndex=index;
    if(index.partial){indexFailed=true;indexRequest=null;}
    if(viewport){viewport.indexRows=null;applyViewport(viewport);}
    else if(!map && city?.id==='us'){places=index.query({west:-180,east:180,south:-90,north:90});render();}
  }).catch(()=>{
    indexFailed=true;indexRequest=null;
    if(viewport)applyViewport(viewport);
  });
  return indexRequest;
}

function fetchGuide(id) {
  if(guides.has(id))return guides.get(id);
  const request=fetch('./data/'+id+'.json').then(async response=>{
    if(!response.ok)throw Error('Guide unavailable');
    const data=await response.json();
    if(!Array.isArray(data.locations))throw Error('Invalid guide');
    return data;
  });
  // Keep only a few recently requested guides in memory.
  guides.set(id,request);
  if(guides.size>4)guides.delete(guides.keys().next().value);
  request.catch(()=>{if(guides.get(id)===request)guides.delete(id);});
  return request;
}

function areaMessage() {
  if(!viewport)return 'Move the map to explore nearby stops.';
  if(!viewport.regions.length)return 'This view is outside U.S. coverage. Pan back or choose a state.';
  const state=viewport.detail.state;
  if(state==='error')return 'Neighborhood listings could not load. Retry to check this area.';
  if(state==='partial')return 'Some neighborhood listings could not load. Retry for the remaining area.';
  if(indexFailed || catalogFailed || viewport.guideFailed || viewport.atlasFailed)return 'Part of the directory could not load. Retry for more stops.';
  if(state==='loading')return 'Finding mapped places in this area…';
  if(!nationalIndex || !venueAtlas || viewport.atlasLoading || viewport.guidesLoading)return 'Loading the directory for this area…';
  if(filters.has('showers'))return 'Shows locations with documented showers. Check each listing for access and fees.';
  if(viewport.cells?.length)return $('search-input').value || filters.size>0 && !filters.has('confirmed') && !filters.has('roadside') ? 'Zoom in to search and filter all neighborhood listings.' : 'Select a map area to explore its stops.';
  if(state==='overview')return places.length ? 'Zoom in for restaurants, gas stations and individual restrooms.' : 'Zoom in to check this area for neighborhood stops.';
  return places.length ? 'Mapped stops in this view. Select a pin for access details.' : 'No stops are mapped in this view. Zoom out or try a nearby town.';
}

function applyViewport(area) {
  if(viewport!==area)return;
  const inView=pointFilter(area.bounds);
  // The featured guides carry the most detailed access facts. Keep their IDs
  // when a community map tile describes the same establishment.
  // All aliases in this view refer to the same record object, including when
  // an operator directory supplies additional details for a bundled guide pin.
  const records=area.guidePlaces.filter(inView).map(place=>({...place}));
  const matcher=createVenueMatcher(records);
  const add=place=>{
    if(!place)return;
    const match=matcher.find(place);
    if(!match){
      const record={...place};
      matcher.add(record);records.push(record);
      return;
    }
    matcher.alias(place.id,match);
    if(place.roadside===true)match.roadside=true;
    const operator = place.evidenceType==='operator-directory';
    const officialShower = typeof place.showers==='boolean' && operator;
    const existingOfficial = match.showerSourceType==='operator-directory' ||
      (match.evidenceType==='operator-directory' && typeof match.showers==='boolean');
    if(officialShower || (place.showers===true && !existingOfficial)){
      match.showers=place.showers;
      if(officialShower)match.showerSourceType='operator-directory';
      if(place.showerCount!=null)match.showerCount=place.showerCount;
      if(place.accessibleShowerCount!=null)match.accessibleShowerCount=place.accessibleShowerCount;
      if(place.showerNote && (operator || !match.showerNote))match.showerNote=place.showerNote;
    }
    if(place.phone && !match.phone && place.evidenceType==='operator-directory')match.phone=place.phone;
    if(place.showers===true || place.roadside===true){
      const urls=new Set((match.sources||[]).map(source=>source.url));
      const additional=[];
      for(const source of place.sources||[]){
        if(!urls.has(source.url)){additional.push(source);urls.add(source.url);}
      }
      if(additional.length)match.sources=[...(match.sources||[]),...additional];
    }
  };
  if(nationalIndex){
    area.indexRows ??= nationalIndex.query(area.bounds);
    for(const place of area.indexRows)add(place);
  }
  for(const place of area.atlasPlaces)add(place);
  for(const feature of area.detail.features){
    if(!converted.has(feature))converted.set(feature,placeFromFeature(feature));
    add(converted.get(feature));
  }
  // Preserve the open detail during tile requests when its pin is still visible.
  const selected=placeIndex.get(selectedId);
  if(selected && inView(selected)){
    const available=matcher.find(selected);
    if(available)matcher.alias(selected.id,available);else add(selected);
    const promoted=matcher.byId(selected.id);
    if(promoted){
      const changed=['id','roadside','showers','showerCount','accessibleShowerCount','showerNote','phone']
        .some(field=>promoted[field]!==selected[field]) || promoted.sources?.length!==selected.sources?.length;
      if(promoted.id!==selectedId){selectedId=promoted.id;writeRouteURL(spotURL(promoted));}
      if(changed)renderDetails(promoted);
    }
  }
  places=records;
  for(const p of records)if(saved.has(p.id))savedPlaces.set(p.id,p);
  render();
  const center=map.getCenter();
  const localGuide=city?.id!=='us' && distanceMiles(center,city)<10 && area.zoom>=10;
  $('area-name').textContent=localGuide ? city.name + ', ' + city.state :
    area.regions.length===1 ? area.regions[0].name :
    area.regions.length===2 ? area.regions.map(r=>r.code).join(' / ') :
    area.regions.length ? 'United States' : 'Outside the U.S.';
  $('area-status').textContent=areaMessage();
  $('area-retry').hidden=!(indexFailed || catalogFailed || area.guideFailed || area.atlasFailed || ['error','partial'].includes(area.detail.state));
  if(pendingSpot){
    const match=matcher.byId(pendingSpot.id) || (pendingSpot.place && matcher.find(pendingSpot.place));
    if(match){openDetail(match.id,{fromLink:true});}
    else if(area.detail.state==='ready' && !area.guidesLoading && !area.atlasLoading && nationalIndex && venueAtlas){
      $('area-status').textContent='The shared listing is absent from this map update. Showing nearby stops.';
    }
  }
}

function refreshViewport() {
  if(!map)return;
  discovery?.cancel();
  const bounds=mapBounds(map), zoom=map.getZoom();
  const regionList=usRegionsInBounds(bounds);
  const guideList=(cityGuide?.cities || (city.id==='us'?[]:[city])).filter(g=>zoom>=9 && intersects(bounds,g.guideBounds));
  const more=guideList.filter(g=>g.id!==city.id);
  const area={
    bounds, zoom, regions:regionList, detail:{state:'overview',features:[]}, guidesLoading:more.length>0, guideFailed:false,
    atlasPlaces:[],cells:[],atlasLoading:false,atlasFailed:false,
    guidePlaces:guideList.some(g=>g.id===city.id) ? currentGuide : []
  };
  viewport=area;
  visibleLimit=60;
  readAtlasArea(area);
  if(more.length){
    void Promise.allSettled(more.map(g=>fetchGuide(g.id))).then(results=>{
      if(viewport!==area)return;
      for(const result of results){
        if(result.status==='fulfilled')area.guidePlaces=area.guidePlaces.concat(result.value.locations);
        else area.guideFailed=true;
      }
      area.guidesLoading=false;
      applyViewport(area);
    });
  }
  if(!regionList.length){applyViewport(area);return;}
  discovery ??= createViewportDiscovery({onUpdate:update=>{
    if(!viewport)return;
    viewport.detail=update;
    applyViewport(viewport);
  }});
  void discovery.load(bounds,zoom);
}

async function changeCity(next) {
  const revision=++navigating;
  const routeAtStart=routeURL();
  const data=next.id==='us' ? {locations:[],meta:{}} : await fetchGuide(next.id);
  if(revision!==navigating)return;
  closeDetail(false);
  if(routeAtStart.searchParams.has('spot'))writeRouteURL(routeAtStart);
  pendingSpot=null;
  clearTimeout(refreshTimer);discovery?.cancel();viewport=null;
  mapObserver?.disconnect();
  if(map){map.remove();map=null;}
  document.body.dataset.mapRenderer='pending';
  markerLayer=null;atlasLayer=null;userMarker=null;userCircle=null;markers.clear();
  city=next;cityRevision++;meta=data.meta;currentGuide=data.locations;
  places=currentGuide;visibleLimit=60;
  filters.clear();savedOnly=false;$('search-input').value='';
  $('sort-select').value=position?'distance':'recommended';
  $('location-status').textContent='';
  $('map-status').hidden=true;
  applyCity(next);
  await initializeMap();
  if(!map){places=city.id==='us' && nationalIndex ? nationalIndex.query({west:-180,east:180,south:-90,north:90}) : currentGuide;}
  render();drawPosition();
  if($('checked-date'))$('checked-date').textContent=meta.checkedLabel || 'See each listing';
  if(map)requestAnimationFrame(()=>map?.invalidateSize({pan:false}));
}

let savedRequest;
async function restoreSaved() {
  if(savedRequest)return savedRequest;
  if(!nationalIndex)await startIndex();
  const missing=[...saved].filter(id=>!savedPlaces.has(id));
  if(!missing.length)return;
  savedRequest=(async()=>{
    const remember=p=>{if(p && saved.has(p.id))savedPlaces.set(p.id,p);};
    for(const p of await getCachedPlaces(missing))remember(p);
    for(const id of missing)remember(nationalIndex?.get(id));
    const legacy=new Set(missing.filter(id=>!savedPlaces.has(id) && !id.startsWith('us-')));
    if(legacy.size){
      // V1–V3 saved IDs did not contain a reliable guide prefix.
      const res=await fetch('./locations.json');
      if(!res.ok)return;
      const list=(await res.json()).locations;
      const needed=new Set(list.filter(p=>legacy.has(p.id)).map(p=>p.cityId));
      await Promise.all([...needed].map(async id=>{
        const data=await fetchGuide(id);
        for(const p of data.locations)if(legacy.has(p.id))remember(p);
      }));
    }
  })().catch(()=>toast('Some saved stops could not be loaded.')).finally(()=>{savedRequest=null;});
  return savedRequest;
}

function restoreSpot() {
  const url=routeURL();
  const id=url.searchParams.get('spot');
  pendingSpot=null;
  if(!id)return;
  const known=placeIndex.get(id) || currentGuide.find(p=>p.id===id) || nationalIndex?.get(id);
  const raw=url.searchParams.get('near');
  const near=raw?.split(',').map(Number);
  const point=known || (near?.length===2 && near.every(Number.isFinite) && Math.abs(near[0])<=90 && Math.abs(near[1])<=180 ? {lat:near[0],lng:near[1]} : null);
  if(!point)return;
  pendingSpot={id,place:known};
  if(map){
    map.setView([point.lat,point.lng],16,{animate:false});
    // Covers links targeting a point already centered in the current view.
    refreshViewport();
  }else if(known){placeIndex.set(id,known);openDetail(id,{fromLink:true});}
}

async function start() {
  const autoLocate=shouldLocateOnStart(routeURL().href);
  bindEvents();initMapStyle();createOcean();
  new ResizeObserver(()=>{
    const top=document.querySelector('.sidebar').getBoundingClientRect().bottom-document.querySelector('.workspace').getBoundingClientRect().top+12;
    $('app').style.setProperty('--mobile-controls-top',top+'px');
  }).observe(document.querySelector('.sidebar'));
  document.addEventListener('restorecityspot',restoreSpot);
  void startIndex();void startAtlas();
  try {
    cityGuide=await initCityGuide(changeCity);
    setView(map?'map':'list');
    restoreSpot();
    if(autoLocate)locate({auto:true});
    void initRatings(()=>{render();if(selectedId && placeIndex.has(selectedId))renderDetails(placeIndex.get(selectedId));},toast);
  } catch(error) {
    setView('list');$('result-count').textContent='The directory couldn’t load';
    $('result-list').innerHTML='<div class="empty-state"><h3>Directory unavailable</h3><p>Refresh to try loading the map again.</p><button class="secondary-action" id="reload-btn">Retry</button></div>';
    $('reload-btn').addEventListener('click',()=>location.reload());
    console.error(error);
  }
}
start();
