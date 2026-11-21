// Original cartographic palettes inspired by the poster-map approach at Terraink.
// Real OpenMapTiles geometry; no copied Terraink source, branding, or API key.
const PALETTES={
 us:['Continental Survey','#173c3b','#0b282e','#2a5041','#6b9385','#f1c77e','#b3c89a','#d4e6cd'],
 'key-west':['Conch Coast','#082f3b','#05222f','#184f4b','#4c9091','#f7df94','#79d5ce','#c6eee4'],
 nyc:['Midnight Manhattan','#151a20','#0a121d','#243c34','#798694','#e6c98b','#bac5c5','#d5dbe1'],
 miami:['Deco After Dark','#211332','#100e29','#21464b','#965e8e','#f7c679','#f082c2','#66ded1'],
 la:['Pacific Afterglow','#2a1c36','#14162c','#3e494a','#a7737a','#f4b66b','#db8294','#e6b69d'],
 austin:['Copper & Neon','#211c19','#102c35','#33443c','#7b6861','#e9b268','#d98056','#c5b89b'],
 sf:['Golden Gate Ink','#152d36','#09232f','#294f42','#708d8e','#ed9a75','#ca715d','#a6cac6'],
 chicago:['Lakefront Steel','#10283d','#081b30','#28483f','#5d8b9d','#edc780','#8fc4cf','#bed8db'],
 seattle:['Emerald Sound','#102e2d','#09232f','#2b4c3f','#618b86','#dac58b','#7dcdb5','#c7ddd1'],
 'new-orleans':['Violet & Brass','#23182d','#121b2d','#30463b','#7b628c','#dfbe68','#b599c8','#9db9a8'],
 nashville:['Blue Note','#142938','#0b1c30','#314138','#628396','#edb97a','#b7a27e','#a5c6ce'],
 boston:['Harbor & Brick','#182a30','#0a2130','#31473a','#8e7774','#ddb880','#bc7a6b','#bbc5bc'],
 dc:['Capital Blueprint','#14273b','#0a1b31','#2e4a42','#6a8da5','#dec69a','#9eafc7','#b8d4db'],
 'san-diego':['Pacific Current','#0e303e','#052234','#254d45','#65999f','#e6c088','#89cbc4','#c5dfda'],
 portland:['Rose City Press','#192e27','#10252d','#3b4e37','#73876d','#d8b88a','#9fbda4','#c6cebc'],
 denver:['Alpine Print','#152a3b','#0b1e31','#314d47','#7993a1','#e4bb8a','#a5c9ce','#d3dde0'],
 'las-vegas':['Neon Strip','#1d1230','#100d25','#292d42','#89558d','#f5cb76','#e37bbd','#ba9fdf'],
 phoenix:['Sonoran Etching','#2b1c24','#161b2e','#3b413a','#9d6e69','#e7b77b','#cd8e6d','#d5bd9c'],
 atlanta:['Peachtree Canopy','#142d2b','#0c212a','#2d4b3a','#658a7e','#e0b78d','#95c0ab','#c6d8c0'],
 charleston:['Lowcountry Copper','#17343c','#0b2532','#344e42','#829a96','#e6b395','#b7cdbb','#e2d0b9'],
 savannah:['Live Oak Etching','#1c3028','#10252d','#3b4d36','#7f936f','#d5b984','#a8bb8c','#d6d4b6'],
 orlando:['Lakes After Dark','#1b2440','#0d1930','#2b4e47','#7985aa','#d5bd88','#9d8dd3','#7dd1cd'],
 honolulu:['Pacific Blue Hour','#0d3440','#052438','#284f44','#6b9d9d','#e4b989','#88d2c4','#cae0cc'],
 dallas:['Metroplex Lines','#142a40','#0c1b30','#2d443d','#6b90a4','#d7bd8b','#9ec2d0','#cbd7d2'],
 houston:['Bayou Blueprint','#102b3d','#0a1e31','#2c493e','#688a98','#dfae85','#83c0c0','#bdcfc5']
};
export function cartographicPalette(city){
 const [name,background,water,park,local,highway,arterial,label]=PALETTES[city.id]||PALETTES.nyc;
 return {name,background,water,park,local,highway,arterial,label};
}
export function buildMapStyle(city,mode='wireframe') {
 const dark=cartographicPalette(city);const p=mode==='city'?{...dark,background:'#f4f5ef',water:'#b9dbe0',park:'#d9e5d2',local:'#b0b5b0',highway:city.accent,arterial:'#7a969b',label:'#33545e'}:dark;
 const src='openmaptiles';const line=(id,layer,color,width,filter,extra={})=>({id,type:'line',source:src,'source-layer':layer,...(filter?{filter}:{}),layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':width,...extra}});
 const major=['in',['get','class'],['literal',['motorway','trunk','primary']]];
 const arterial=['in',['get','class'],['literal',['secondary','tertiary']]];
 const local=['in',['get','class'],['literal',['minor','service','street','residential','unclassified']]];
 const labelName=['coalesce',['get','name:en'],['get','name:latin'],['get','name']];
 const labelPaint={'text-color':p.label,'text-halo-color':p.background,'text-halo-width':1.4};
 const placeLabel=(id,classes,minzoom,maxzoom,layout)=>({
  id,type:'symbol',source:src,'source-layer':'place',minzoom,maxzoom,
  filter:['in',['get','class'],['literal',classes]],
  layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':12,'text-padding':5,'symbol-sort-key':['to-number',['get','rank'],99],...layout},
  paint:labelPaint
 });
 const width=(a,b,c)=>['interpolate',['linear'],['zoom'],7,a,12,b,17,c];
 return {version:8,name:`IN A PINCH · ${city.name} · ${p.name}`,metadata:{cityId:city.id,mode,theme:p.name},glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{[src]:{type:'vector',url:'https://tiles.openfreemap.org/planet',attribution:'© OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors'}},layers:[
  {id:'background',type:'background',paint:{'background-color':p.background}},
  {id:'green-space',type:'fill',source:src,'source-layer':'landcover',filter:['in',['get','class'],['literal',['wood','grass','wetland']]],paint:{'fill-color':p.park,'fill-opacity':.5}},
  {id:'parks',type:'fill',source:src,'source-layer':'park',paint:{'fill-color':p.park,'fill-opacity':.65}},
  {id:'water',type:'fill',source:src,'source-layer':'water',paint:{'fill-color':p.water}},
  line('waterways','waterway',p.water,width(.3,.8,2)),
  {id:'building-ink',type:'fill',source:src,'source-layer':'building',minzoom:13,paint:{'fill-color':p.local,'fill-opacity':mode==='city'?.12:.075}},
  line('building-contours','building',p.local,width(0,.1,.6),null,{'line-opacity':.35}),
  line('major-road-glow','transportation',p.highway,width(.5,3,8),major,{'line-opacity':mode==='city'?.08:.17,'line-blur':2}),
  line('local-streets','transportation',p.local,width(.08,.35,1.25),local,{'line-opacity':.8}),
  line('footpaths','transportation',p.local,width(0,.25,.7),['in',['get','class'],['literal',['path','pedestrian','track']]],{'line-opacity':.55,'line-dasharray':[2,3]}),
  line('arterial-roads','transportation',p.arterial,width(.25,.8,2.1),arterial),
  line('major-roads','transportation',p.highway,width(.4,1.3,3),major),
  line('rail-lines','transportation',p.arterial,width(.15,.4,1),['==',['get','class'],'rail'],{'line-opacity':.45,'line-dasharray':[3,3]}),
  {...line('state-boundaries','boundary',p.label,1.1,['==',['get','admin_level'],4],{'line-opacity':.46,'line-dasharray':[3,2]}),maxzoom:10},
  {...line('country-boundaries','boundary',p.label,1.4,['==',['get','admin_level'],2],{'line-opacity':.62}),maxzoom:10},
  placeLabel('regional-place-names',['city','town','village','hamlet'],4,13,{
   'text-size':['interpolate',['linear'],['zoom'],4,10,10,13]
  }),
  placeLabel('state-names',['state','province'],2,8,{
   'text-size':['interpolate',['linear'],['zoom'],2,10,6,13],
   'text-letter-spacing':.12,'text-transform':'uppercase','text-padding':8
  }),
  {id:'neighborhood-names',type:'symbol',source:src,'source-layer':'place',minzoom:10,filter:['in',['get','class'],['literal',['suburb','neighbourhood','quarter','borough','town']]],layout:{'text-field':['coalesce',['get','name:latin'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':11,'text-letter-spacing':.12,'text-transform':'uppercase','text-max-width':10},paint:{'text-color':p.label,'text-opacity':.68,'text-halo-color':p.background,'text-halo-width':2}},
  {id:'street-names',type:'symbol',source:src,'source-layer':'transportation_name',minzoom:14,layout:{'symbol-placement':'line','text-field':['coalesce',['get','name:latin'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':11,'text-max-angle':25,'text-padding':10},paint:{'text-color':p.label,'text-opacity':.85,'text-halo-color':p.background,'text-halo-width':1.5}},
  // Invisible POI layer keeps real business geometry available for venue discovery.
  {id:'venue-discovery',type:'circle',source:src,'source-layer':'poi',minzoom:14,paint:{'circle-radius':0,'circle-opacity':0}}
 ]};
}
