"""Build a compact Key West basemap from genuine OpenStreetMap geometry.

License: OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0.
https://www.openstreetmap.org/copyright

Usage (all data downloaded from public OpenStreetMap API, no API key):
  python scripts/build_vector_map.py --download --source-dir /tmp/key-west-osm
  python scripts/build_vector_map.py --source-dir /path/to/cached/xml

The download bounding boxes below correspond exactly to the source snapshots
used for the map. The OSM API returns full ways intersecting each box. Features
are deduplicated by OSM ID. Coastlines are joined ONLY on exact shared OSM node
IDs. Open coastlines are reported and omitted; no island boundary is guessed.
Douglas–Peucker simplification uses about 2 m tolerance; coordinates are rounded
to six decimal places. The source is a snapshot, not a live map feed.
"""
import glob, xml.etree.ElementTree as ET, math, json, os, collections
import argparse, pathlib, urllib.request
REPO = pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir', default='/tmp/key-west-osm')
parser.add_argument('--output', default=str(REPO/'assets/key-west-map.json'))
parser.add_argument('--download', action='store_true')
args=parser.parse_args()
P=str(pathlib.Path(args.source_dir).resolve())+'/'
OUT=args.output
SOURCE_BOXES={
 'osm-central.xml':(-81.81,24.55,-81.79,24.57),
 'osm-region-0.xml':(-81.815,24.535,-81.79,24.55),
 'osm-region-2.xml':(-81.79,24.57,-81.73,24.585),
 'osm-east-0.xml':(-81.79,24.54,-81.77,24.57),
 'osm-east-1.xml':(-81.77,24.54,-81.745,24.57),
 'osm-map-edge-0.xml':(-81.744,24.582,-81.721,24.591),
 'osm-map-edge-1.xml':(-81.741,24.55,-81.719,24.571),
 'osm-map-edge-2.xml':(-81.732,24.574,-81.719,24.583),
}
if args.download:
 os.makedirs(P,exist_ok=True)
 for filename,bounds in SOURCE_BOXES.items():
  if os.path.exists(P+filename):continue
  url='https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str,bounds))
  request=urllib.request.Request(url,headers={'User-Agent':'InAPinchKeyWest-basemap/1.0'})
  with urllib.request.urlopen(request,timeout=60) as response:
   pathlib.Path(P+filename).write_bytes(response.read())
if not glob.glob(P+'osm*.xml'):raise SystemExit('No OSM XML found; use --download or --source-dir.')
BOUNDS=(-81.820,24.530,-81.725,24.590)
nodes={};node_tags={};ways={};relations={}
for fn in glob.glob(P+'osm*.xml'):
 r=ET.parse(fn).getroot()
 for e in r.findall('node'):
  nodes[e.get('id')]=(float(e.get('lon')),float(e.get('lat')))
  node_tags[e.get('id')]={x.get('k'):x.get('v') for x in e.findall('tag')}
 for e in r.findall('way'):
  ways[e.get('id')]={'refs':[x.get('ref') for x in e.findall('nd')],'tags':{x.get('k'):x.get('v') for x in e.findall('tag')}}
 for e in r.findall('relation'):
  relations[e.get('id')]={'members':[(m.get('type'),m.get('ref'),m.get('role')) for m in e.findall('member')],'tags':{x.get('k'):x.get('v') for x in e.findall('tag')}}

def simplify(coords,eps=0.000018):
 if len(coords)<3:return coords
 x1,y1=coords[0];x2,y2=coords[-1];dx=x2-x1;dy=y2-y1;length=dx*dx+dy*dy
 best=0;index=0
 for i,(x,y) in enumerate(coords[1:-1],1):
  t=max(0,min(1,((x-x1)*dx+(y-y1)*dy)/length)) if length else 0
  d=(x-x1-t*dx)**2+(y-y1-t*dy)**2
  if d>best:best=d;index=i
 if best>eps*eps:return simplify(coords[:index+1],eps)[:-1]+simplify(coords[index:],eps)
 return [coords[0],coords[-1]]

def polygon_area(c):return abs(sum(c[i][0]*c[i+1][1]-c[i+1][0]*c[i][1] for i in range(len(c)-1)))/2

def rounded(c):return [[round(x,6),round(y,6)] for x,y in c]
def intersectbounds(c):return bool(c) and max(x for x,y in c)>=BOUNDS[0] and min(x for x,y in c)<=BOUNDS[2] and max(y for x,y in c)>=BOUNDS[1] and min(y for x,y in c)<=BOUNDS[3]

def clean_poly(coords,eps=.000018):
 if len(coords)<4 or coords[0]!=coords[-1]:return None
 # Split the loop at the farthest vertex so closed-ring RDP cannot collapse a polygon.
 start=coords[0];far=max(range(1,len(coords)-1),key=lambda i:(coords[i][0]-start[0])**2+(coords[i][1]-start[1])**2)
 c=simplify(coords[:far+1],eps)[:-1]+simplify(coords[far:],eps)
 if len(c)<4 or polygon_area(c)<.000000002:return None
 return rounded(c)

def join_refs(items):
 # Join only exact shared OSM node references, never bridge a geographic gap.
 pending=dict(items);rings=[];openchains=[]
 while pending:
  k,refs=pending.popitem();ids=[k];chain=list(refs)
  while chain[0]!=chain[-1]:
   found=None
   for a,b in pending.items():
    if b[0]==chain[-1]:found=(a,b,False);break
    if b[-1]==chain[-1]:found=(a,list(reversed(b)),False);break
    if b[-1]==chain[0]:found=(a,b,True);break
    if b[0]==chain[0]:found=(a,list(reversed(b)),True);break
   if not found:break
   a,b,prepend=found;pending.pop(a);ids.append(a)
   chain=b[:-1]+chain if prepend else chain+b[1:]
  (rings if chain[0]==chain[-1] else openchains).append((ids,chain))
 return rings,openchains

def bboxcoords(c):return [min(x for x,y in c),min(y for x,y in c),max(x for x,y in c),max(y for x,y in c)]
coast={k:v['refs'] for k,v in ways.items() if v['tags'].get('natural')=='coastline'}
rings,openchains=join_refs(coast)
features=[]
for ids,refs in rings:
 if not all(x in nodes for x in refs):continue
 coords=[nodes[x] for x in refs]
 if not intersectbounds(coords):continue
 ring=clean_poly(coords,.000018)
 if not ring:continue
 tags=next((ways[i]['tags'] for i in ids if ways[i]['tags'].get('name')), {})
 name=tags.get('name');bb=bboxcoords(coords)
 if not name and bb[0]<-81.81 and bb[2]>-81.75:name='Key West'
 elif not name and bb[0]<-81.79 and bb[1]>24.56 and bb[3]>24.575:name='Fleming Key'
 elif not name and bb[0]<-81.74 and bb[2]>-81.73 and bb[3]>24.58:name='Stock Island'
 props={'kind':'land','osm':'way/'+','.join(ids)}
 if name:props['name']=name
 features.append({'type':'Feature','properties':props,'geometry':{'type':'Polygon','coordinates':[ring]}})

major_roads={'trunk','trunk_link','primary','secondary','tertiary','tertiary_link','residential','unclassified','living_street','pedestrian'}
optional_roads={'cycleway','path','footway'}
for k,v in ways.items():
 t=v['tags'];refs=v['refs']
 if not all(x in nodes for x in refs):continue
 coords=[nodes[x] for x in refs]
 if not intersectbounds(coords):continue
 typ=None;kind=None
 if t.get('highway') in major_roads or (t.get('highway')=='service' and t.get('name')) or (t.get('highway') in optional_roads and (t.get('name') or t.get('bicycle')=='designated')):
  typ='LineString';kind='road';c=rounded(simplify(coords,.000013));props={'kind':kind,'highway':t['highway']}
  if len(c)<2:continue
  if t.get('bridge'):props['bridge']=t['bridge']
 elif t.get('aeroway') in {'runway','apron','taxiway'}:
  kind='runway';props={'kind':kind,'subkind':t['aeroway']}
  if t.get('width'):props['width']=t['width']
  if refs[0]==refs[-1]:
   ring=clean_poly(coords);typ='Polygon';c=[ring] if ring else None
  else:typ='LineString';c=rounded(simplify(coords))
  if not c:continue
 elif t.get('natural')=='water' and refs[0]==refs[-1]:
  typ='Polygon';kind='water';ring=clean_poly(coords)
  if not ring:continue
  c=[ring];props={'kind':kind,'subkind':t.get('water','water')}
 elif (t.get('leisure') in {'park','garden','playground','nature_reserve','golf_course','dog_park','pitch','recreation_ground'} or t.get('natural') in {'beach','wood','wetland','scrub'} or t.get('landuse') in {'forest','cemetery','recreation_ground'}) and refs[0]==refs[-1] and t.get('natural')!='coastline':
  typ='Polygon';kind='beach' if t.get('natural')=='beach' else 'park';ring=clean_poly(coords,.00002)
  if not ring:continue
  c=[ring];props={'kind':kind,'subkind':t.get('natural') or t.get('leisure') or t.get('landuse')}
 elif t.get('building') and refs[0]==refs[-1] and (t.get('amenity') in {'toilets','library','townhall','community_centre'} or t.get('tourism')=='museum' or t.get('historic')=='fort' or t.get('aeroway')=='terminal'):
  typ='Polygon';kind='building';ring=clean_poly(coords,.000009)
  if not ring:continue
  c=[ring];props={'kind':kind,'subkind':t.get('amenity') or t.get('tourism') or t.get('historic') or t.get('aeroway')}
 else:continue
 if t.get('name'):props['name']=t['name']
 props['osm']='way/'+k
 features.append({'type':'Feature','properties':props,'geometry':{'type':typ,'coordinates':c}})

# Add complete water/park multipolygons, including genuine holes when all rings are mapped.
for k,v in relations.items():
 t=v['tags'];kind='water' if t.get('natural')=='water' else 'park' if t.get('leisure') in {'park','nature_reserve','garden'} or t.get('natural') in {'wood','wetland'} else None
 if not kind or t.get('type')!='multipolygon':continue
 outer={r:ways[r]['refs'] for typ,r,role in v['members'] if typ=='way' and role in {'outer',''} and r in ways}
 inner={r:ways[r]['refs'] for typ,r,role in v['members'] if typ=='way' and role=='inner' and r in ways}
 if len(outer)!=len([1 for typ,r,role in v['members'] if typ=='way' and role in {'outer',''}]):continue
 ors,ops=join_refs(outer);irs,ips=join_refs(inner)
 if ops or ips:continue
 polygons=[]
 for _,rs in ors:
  if not all(r in nodes for r in rs):continue
  coords=[nodes[r] for r in rs]
  if not intersectbounds(coords):continue
  ring=clean_poly(coords)
  if ring:polygons.append([ring])
 if not polygons:continue
 # Inner rings attach only to a containing exterior, using exact point-in-polygon.
 def inside(pt,ring):
  x,y=pt;hit=False
  for i in range(len(ring)-1):
   a,b=ring[i],ring[i+1]
   if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:hit=not hit
  return hit
 for _,rs in irs:
  if not all(r in nodes for r in rs):continue
  ri=clean_poly([nodes[r] for r in rs])
  if not ri:continue
  for poly in polygons:
   if inside(ri[0],poly[0]):poly.append(ri);break
 props={'kind':kind,'osm':'relation/'+k,'subkind':t.get('water') or t.get('leisure') or t.get('natural')}
 if t.get('name'):props['name']=t['name']
 features.append({'type':'Feature','properties':props,'geometry':{'type':'MultiPolygon','coordinates':polygons}})

for k,t in node_tags.items():
 if not t.get('name'):continue
 if t.get('place') not in {'city','town','village','suburb','neighbourhood','quarter','island','islet','locality'} and t.get('natural') not in {'bay','strait'}:continue
 xy=nodes[k]
 if not (BOUNDS[0]<=xy[0]<=BOUNDS[2] and BOUNDS[1]<=xy[1]<=BOUNDS[3]):continue
 features.append({'type':'Feature','properties':{'kind':'label','name':t['name'],'place':t.get('place') or t.get('natural'),'osm':'node/'+k},'geometry':{'type':'Point','coordinates':rounded([xy])[0]}})
order={'land':0,'park':1,'beach':2,'water':3,'runway':4,'road':5,'building':6,'label':7}
features.sort(key=lambda f:order[f['properties']['kind']])
result={'type':'FeatureCollection','attribution':'© OpenStreetMap contributors','license':'https://www.openstreetmap.org/copyright','bounds':list(BOUNDS),'generated':'2026-11-21','features':features}
os.makedirs(os.path.dirname(OUT),exist_ok=True)
with open(OUT,'w') as f:json.dump(result,f,separators=(',',':'),ensure_ascii=False)
print('OUTPUT',OUT,'BYTES',os.path.getsize(OUT),'COUNTS',dict(collections.Counter(f['properties']['kind'] for f in features)))
print('LANDS',[(f['properties'].get('name'),len(f['geometry']['coordinates'][0])) for f in features if f['properties']['kind']=='land'])
print('UNJOINED COASTS',[(ids,nodes.get(refs[0]),nodes.get(refs[-1])) for ids,refs in openchains])
