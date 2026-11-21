import {escapeHTML as e, normalize} from './logic.js';
import {usRegions} from './us-geography.js';
// A file URL may change only its fragment through the History API. Keep the
// normal hosted query syntax as the internal route in both entry points.
export function routeURL(href = location.href) {
  const url = new URL(href);
  if (url.protocol === 'file:' && url.hash.startsWith('#pinch?')) {
    url.search = url.hash.slice(7);
    url.hash = '';
  }
  return url;
}
export function writeRouteURL(route, push = false) {
  const current = new URL(location.href);
  let target = route;
  if (current.protocol === 'file:') {
    target = new URL(current);
    target.hash = 'pinch?' + route.searchParams.toString();
  }
  if (target.href === current.href) return;
  try { history[push ? 'pushState' : 'replaceState'](null,'',target); }
  catch (error) {
    // Restricted embedded file previews may disable history entirely.
    if (current.protocol !== 'file:' || error.name !== 'SecurityError') throw error;
  }
}
export let cities = [];
export const nationalGuide = {
  id:'us', code:'US', name:'United States', state:'', region:'United States',
  lat:39, lng:-98, deep:'#133f40', accent:'#177166', highlight:'#f9d781',
  theme:'National atlas', motif:'atlas', art:'assets/cities/us.svg',
  headline:['THE U.S.', 'RESTROOM ATLAS.'],
  tagline:'Find a restroom on your route, from downtown to the next town over.'
};
const $ = id => document.getElementById(id);
export function nearestCity(position) {
  const rad=Math.PI/180;
  return [...cities].sort((a,b)=>{
    const distance=c=>Math.acos(Math.min(1,Math.max(-1,Math.sin(position.lat*rad)*Math.sin(c.lat*rad)+Math.cos(position.lat*rad)*Math.cos(c.lat*rad)*Math.cos((position.lng-c.lng)*rad))));
    return distance(a)-distance(b);
  })[0];
}
export function applyCity(city) {
  const national = city.id === nationalGuide.id;
  const cityLabel = national ? city.name : `${city.name}, ${city.state}`;
  const root = document.documentElement;
  const theme = {'city-deep':city.deep,'city-accent':city.accent,'city-highlight':city.highlight,'city-art':`url("${city.art}")`};
  for (const [key,value] of Object.entries(theme)) root.style.setProperty(`--${key}`,value);
  document.body.dataset.city = city.id;
  document.body.dataset.motif = city.motif;
  document.title = national ? 'IN A PINCH V4 · U.S. Restroom Atlas' : `IN A PINCH V4 · ${cityLabel} Bathroom Map`;
  document.querySelector('meta[name="theme-color"]').content = city.deep;
  document.querySelector('meta[name="description"]').content = national
    ? 'Explore the U.S. restroom atlas. Find nearby places, check access details and get walking directions.'
    : `Explore restroom stops in ${cityLabel} and across the U.S. with access details and directions.`;
  $('current-city-name').textContent = cityLabel;
  $('current-city-code').textContent = city.code;
  $('city-picker-btn').setAttribute('aria-label', `Browse map destinations. Current guide: ${cityLabel}`);
  document.querySelector('.intro .eyebrow').textContent = national ? 'IN A PINCH · NATIONAL EDITION' : `${cityLabel} · ${city.theme}`;
  document.querySelector('.intro h1').innerHTML = `${e(city.headline[0])}<br><span>${e(city.headline[1])}</span>`;
  document.querySelector('.intro-copy').textContent = city.tagline;
  $('city-local-label').textContent = city.theme;
  document.querySelector('.map-region').setAttribute('aria-label','U.S. restroom map');
  $('map').setAttribute('aria-label', national ? 'Interactive U.S. restroom map' : `Interactive U.S. restroom map, ${cityLabel} guide`);
  document.querySelector('.island-note').innerHTML = national ? '' : `<span>${e(city.code)} · IN A PINCH</span><strong>${e(city.name.toUpperCase())}</strong><span>${e(city.theme.toUpperCase())}</span>`;
  $('about-data-link').href = national ? 'data/atlas-sources.json' : `data/${city.id}.json`;
  $('about-data-link').textContent = national ? 'Nationwide map sources' : `View ${city.name} guide data`;
  $('city-clock').textContent = national ? '' : new Intl.DateTimeFormat('en-US',{timeZone:city.timezone,hour:'numeric',minute:'2-digit'}).format(new Date())+' LOCAL';
  document.querySelectorAll('button[data-city]').forEach(button => {
    const current = button.dataset.city === city.id;
    button.classList.toggle('is-current',current);
    button.setAttribute('aria-pressed', String(current));
  });
  document.querySelectorAll('button[data-national-overview]').forEach(button => button.classList.toggle('is-current',national));
  $('header-motion-btn').hidden = city.id !== 'key-west';
  $('ocean-motion-btn').hidden = city.id !== 'key-west';
  document.dispatchEvent(new CustomEvent('citychange',{detail:city}));
}

export async function initCityGuide(onSelect) {
  const response=await fetch('./cities.json');
  if(!response.ok)throw new Error('City guide unavailable');
  cities=await response.json();
  let selectedId;let pending=false;
  const dialog=$('cities-dialog');
  function renderCities(){
    const query=normalize($('city-search').value);
    const region=$('city-region').value;
    const results=cities.filter(c=>(!region||c.region===region)&&normalize(`${c.name} ${c.state} ${c.code} ${c.region} ${c.theme}`).includes(query));
    $('city-search-count').textContent=`${results.length} ${results.length===1?'city guide':'city guides'}`;
    $('city-grid').innerHTML=results.map(c=>`<button class="city-card ${c.id===selectedId?'is-current':''}" data-city="${e(c.id)}" aria-pressed="${c.id===selectedId}" ${pending?'disabled':''} style="--card-color:${c.deep};--card-accent:${c.highlight}"><span class="city-postcard"><img src="${c.art}" alt="" loading="lazy"><span class="city-code">${e(c.code)}</span><span class="city-current">Selected</span></span><span class="city-card-info"><strong>${e(c.name)}</strong><span>${e(c.state)} · ${e(c.theme)}</span><small>${c.count.toLocaleString()} places · ${c.confirmedCount} restroom-mapped</small></span></button>`).join('')||'<div class="city-empty"><h3>No cities found.</h3><p>Try a city, state, airport code, or another region.</p><button type="button" id="city-reset">Show every destination</button></div>';
  }
  const findDestination = id => id === nationalGuide.id ? nationalGuide : cities.find(c => c.id === id);
  const states = [...usRegions].sort((a,b) => a.name.localeCompare(b.name));
  $('state-jump').innerHTML = '<option value="">Choose a destination</option>' +
    states.map(region => `<option value="${e(region.code)}">${e(region.name)}</option>`).join('');
  const featured=['key-west','nyc','miami','la','austin','sf'];
  $('city-shortcuts').innerHTML=featured.map(id=>{const c=cities.find(c=>c.id===id);return `<button data-city="${id}" aria-pressed="false"><i style="background:${c.accent}"></i>${e(id==='nyc'?'NYC':id==='la'?'Los Angeles':c.name)}</button>`;}).join('');
  $('city-region').innerHTML='<option value="">Every region</option>'+[...new Set(cities.map(c=>c.region))].sort().map(r=>`<option>${e(r)}</option>`).join('');
  $('city-search').addEventListener('input',renderCities);
  $('city-region').addEventListener('change',renderCities);
  $('cities-close').addEventListener('click',()=>dialog.close());
  for(const id of ['city-picker-btn','explore-cities-btn'])$(id).addEventListener('click',()=>{
    renderCities();
    dialog.showModal();
    dialog.querySelector('[data-national-overview]').focus({preventScroll:true});
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  async function select(id,{push=true}={}){
    if(pending)return;
    const city=findDestination(id);if(!city)return;
    pending=true;
    const controls=document.querySelectorAll('button[data-city],button[data-national-overview],#state-jump');
    controls.forEach(control=>{control.disabled=true;});
    $('city-picker-btn').setAttribute('aria-busy','true');
    try{
      await onSelect(city);
      selectedId=city.id;
      applyCity(city);
      if(push){
        const url=routeURL();
        url.searchParams.set('city',city.id);
        url.searchParams.delete('spot');
        url.searchParams.delete('near');
        writeRouteURL(url,true);
      }
      try{localStorage.setItem('in-a-pinch:v4:city',city.id);}catch{}
      dialog.close();
    }catch(error){
      $('city-search-count').textContent='This destination could not load. Please try again.';
      throw error;
    }finally{
      pending=false;$('city-picker-btn').removeAttribute('aria-busy');
      controls.forEach(control=>{control.disabled=false;});
    }
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('#city-reset')){$('city-search').value='';$('city-region').value='';renderCities();return;}
    const button=event.target.closest('button[data-city]');if(button)void select(button.dataset.city).catch(console.error);
  });
  window.addEventListener('popstate',()=>{
    const id=routeURL().searchParams.get('city')||nationalGuide.id;
    void select(id,{push:false}).then(()=>document.dispatchEvent(new CustomEvent('restorecityspot'))).catch(console.error);
  });
  let preferred=nationalGuide.id;
  try{preferred=localStorage.getItem('in-a-pinch:v4:city')||preferred;}catch{}
  const params=routeURL().searchParams;
  const requested=params.get('city');
  if(params.has('spot')&&!requested)preferred=params.has('near')?nationalGuide.id:'key-west';
  const first=findDestination(requested||preferred)||nationalGuide;
  await select(first.id,{push:false});
  const initialURL=routeURL();initialURL.searchParams.set('city',first.id);writeRouteURL(initialURL);
  renderCities();
  return {cities,select};
}
