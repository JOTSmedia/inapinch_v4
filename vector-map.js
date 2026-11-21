import {buildMapStyle, cartographicPalette} from './cartography.js';
import {addStreetMap} from './street-map.js';

export function addVectorMap(map, L, city, status) {
  if (!window.maplibregl || !L.maplibreGL) return addStreetMap(map, L, status);
  let layer, gl, disposed = false, fallback = false, timer;
  const style = () => buildMapStyle(city, document.body.dataset.mapStyle || 'wireframe');
  function fallbackToStreet() {
    if (disposed || fallback) return;
    fallback = true;
    clearTimeout(timer);
    if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    document.body.dataset.mapRenderer = 'raster';
    addStreetMap(map, L, status);
  }
  const updateStyle = () => { if (!disposed && !fallback) gl.setStyle(style()); };
  try {
    layer = L.maplibreGL({style:style(), interactive:false, attributionControl:false, padding:.1}).addTo(map);
    gl = layer.getMaplibreMap();
    document.body.dataset.mapRenderer = 'vector';
    document.documentElement.style.setProperty('--cartographic-bg', cartographicPalette(city).background);
    document.addEventListener('mapstylechange', updateStyle);
    gl.on('idle', () => { if (!disposed && !fallback) {clearTimeout(timer); status.hidden = true;} });
    timer = setTimeout(() => {if (!disposed && !gl.isSourceLoaded('openmaptiles')) fallbackToStreet();}, 15000);
    gl.on('webglcontextlost', fallbackToStreet);
    map.once('unload', () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('mapstylechange', updateStyle);
    });
    return layer;
  } catch {
    fallbackToStreet();
    return null;
  }
}
