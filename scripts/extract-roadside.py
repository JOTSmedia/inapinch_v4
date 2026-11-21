"""Normalize Geofabrik point and polygon facilities from cached state shapefiles."""
import argparse
from collections import Counter
import json
import math
import os
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
TRANSPORT = {'fuel': 'fuel', 'service': 'services', 'services': 'services', 'rest_area': 'rest_area',
             'bus_station': 'bus_station', 'ferry_terminal': 'ferry_terminal', 'railway_station': 'railway_station'}
FACILITIES = ('restaurant bar pub biergarten cafe fast_food food_court nightclub toilet ice_cream bakery library '
              'convenience supermarket mall department_store community_centre museum camp_site '
              'picnic_site park hotel motel cinema theatre stadium visitor_centre caravan_site marketplace '
              'arts_centre sports_hall sports_centre fitness_centre theme_park zoo pharmacy chemist '
              'ice_rink hostel guesthouse general shower showers post_office town_hall courthouse '
              'public_building bookshop doityourself garden_centre laundry').split()

def layer_bytes(folder, name):
    meta = json.loads((folder / 'archive.json').read_text())['files'][name]
    data = (folder / (name + '.compressed')).read_bytes()
    return data if meta['method'] == 0 else zlib.decompress(data, -15)

def representatives(shape):
    kind, = struct.unpack_from('<i', shape)
    if kind in (1, 11, 21):
        return struct.unpack_from('<dd', shape, 4)
    if kind not in (5, 15, 25):
        return None
    # Intersect an interior scanline with all polygon boundaries, including holes.
    # The midpoint of a filled interval stays inside concave and multipart sites.
    parts, points = struct.unpack_from('<ii', shape, 36)
    offsets = [*struct.unpack_from('<' + str(parts) + 'i', shape, 44), points]
    start = 44 + 4 * parts
    xy = list(struct.iter_unpack('<dd', shape[start:start + points * 16]))
    _, ymin, _, ymax = struct.unpack_from('<dddd', shape, 4)
    for frac in (.5, .37, .61):
        y = ymin + (ymax - ymin) * frac
        intersections = []
        for a, b in zip(offsets, offsets[1:]):
            for i in range(a, b):
                x0, y0 = xy[i - 1 if i > a else b - 1]
                x1, y1 = xy[i]
                if (y0 <= y < y1) or (y1 <= y < y0):
                    intersections.append(x0 + (x1 - x0) * (y - y0) / (y1 - y0))
        intersections.sort()
        spans = list(zip(intersections[::2], intersections[1::2]))
        if spans:
            l, r = max(spans, key=lambda pair: pair[1] - pair[0])
            return ((l+r)/2, y)
    return xy[0] if xy else None

def read_layer(folder, name, kinds):
    base = 'gis_osm_' + name + '_free_1'
    dbf = layer_bytes(folder, base + '.dbf')
    shp = memoryview(layer_bytes(folder, base + '.shp'))
    count, head, size = struct.unpack_from('<IHH', dbf, 4)
    fields, cursor = {}, 1
    for offset in range(32, head - 1, 32):
        label = dbf[offset:offset+11].split(b'\0')[0].decode('ascii')
        width = dbf[offset + 16]
        fields[label] = (cursor, cursor + width)
        cursor += width
    prefix = 100
    allowed = {x.encode(): kind for x, kind in kinds.items()}
    rows = []
    for i in range(count):
        record, length = struct.unpack_from('>ii', shp, prefix)
        if record != i+1: raise ValueError('Shapefile/DBF records disagree')
        begin = prefix + 8
        prefix = begin + 2 * length
        pos = head + size*i
        lo, hi = fields['fclass']
        kind = allowed.get(dbf[pos+lo:pos+hi].strip())
        if kind is None or dbf[pos] == 42: continue
        point = representatives(shp[begin:prefix])
        if not point or not all(map(math.isfinite, point)): continue
        x,y = point
        if not -180 <= x <= 180 or not -90 <= y <= 90: continue
        def field(key):
            l,r = fields[key]
            return dbf[pos+l:pos+r].rstrip(b'\x00 ').decode('utf-8', 'replace').strip()
        rows.append([kind, field('osm_id'), field('name'), round(y,6), round(x,6)])
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--layer-set', choices=['roadside','poi'],default='roadside')
    args = parser.parse_args()
    inp = ROOT / 'work/geo-raw'
    for suffix, geom in [('', 'points'), ('_a','areas')]:
        out = ROOT / 'work' / (('roads-' if args.layer_set == 'roadside' else 'nation-') + geom)
        out.mkdir(exist_ok=True, parents=True)
        layers = ['traffic','transport'] if args.layer_set == 'roadside' else ['pois']
        kinds = TRANSPORT if args.layer_set == 'roadside' else {k:('toilets' if k=='toilet' else k) for k in FACILITIES}
        sources = []
        manifest=out/'manifest.json'
        prior={row['slug']:row for row in json.loads(manifest.read_text()).get('extracts',[])} if manifest.exists() else {}
        total_kinds=Counter()
        for f in sorted(inp.glob('*/archive.json')):
            folder=f.parent
            source=json.loads(f.read_text())
            target=out/(folder.name+'.json')
            names=[n+suffix for n in layers if 'gis_osm_'+n+suffix+'_free_1.dbf' in source['files']]
            if not names: continue
            if not all((folder/('gis_osm_'+n+'_free_1.'+ext+'.compressed')).exists() for n in names for ext in ['dbf','shp']): continue
            inputs=[folder/('gis_osm_'+n+'_free_1.'+ext+'.compressed') for n in names for ext in ['dbf','shp']]
            newest_input=max(path.stat().st_mtime_ns for path in [*inputs, Path(__file__)])
            rows=None
            if not target.exists() or target.stat().st_mtime_ns < newest_input:
                rows=[r for n in names for r in read_layer(folder,n,kinds)]
                tmp=target.with_suffix(f'.{os.getpid()}.tmp')
                tmp.write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')))
                tmp.replace(target)
            previous=prior.get(folder.name,{})
            if rows is None and previous.get('kindCounts') is not None:
                kind_counts=previous['kindCounts']
            else:
                kind_counts=dict(sorted(Counter(r[0] for r in (rows if rows is not None else json.loads(target.read_text()))).items()))
            total_kinds.update(kind_counts)
            sources.append({'slug':folder.name,'source':source['source'],'modified':source['modified'],'layers':names,
                            'sourceRowCount':sum(kind_counts.values()),'kindCounts':kind_counts})
        report={'geometry':geom,'sourceRowCount':sum(total_kinds.values()),'kindCounts':dict(sorted(total_kinds.items())),
                'countsBeforeBoundaryAndDeduplication':True,'extracts':sources}
        tmp=manifest.with_suffix(f'.{os.getpid()}.tmp')
        tmp.write_text(json.dumps(report,indent=2))
        tmp.replace(manifest)
        print(out.name, len(sources),'complete sources',flush=True)
if __name__ == '__main__': main()
