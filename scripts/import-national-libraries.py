"""Build the nationwide branch directory from the IMLS FY2024 public-use CSV ZIP.

python3 scripts/import-national-libraries.py /path/to/pls_fy2024_csv.zip
"""
import argparse
import csv
import io
import json
import math
from pathlib import Path
from zipfile import ZipFile

SOURCE = 'https://www.imls.gov/sites/default/files/2026-06/pls_fy2024_csv.zip'
REFERENCE = 'https://www.imls.gov/research-evaluation/surveys/public-libraries-survey-pls'
OUTPUT = Path(__file__).resolve().parents[1] / 'data' / 'national-libraries.json'

def clean(value):
    return '' if value.strip() in ('', 'M', '-1', '-2', '-3') else value.strip()

def convert(outlets):
    rows = []
    for item in outlets:
        if item['C_OUT_TY'].strip() not in ('CE', 'BR') or item['STATSTRU'].strip() == '23':
            continue
        try:
            lat, lng = float(item['LATITUDE']), float(item['LONGITUD'])
        except ValueError:
            continue
        if not all(map(math.isfinite, (lat, lng))) or abs(lat) > 80 or abs(lng) > 180 or abs(lat)<10 or abs(lng)<40:
            continue
        if clean(item.get('GEOSTATUS','')) == 'U':
            continue
        outlet = 'us-library-' + item['FSCSKEY'].strip() + '-' + item['FSCS_SEQ'].strip()
        approximate = item['GEOSTATUS'].strip() != 'E' or item['GEOMTYPE'].strip() in (
            'LOCALITY', 'POSTAL', 'POSTALLOC', 'STREETNAME', 'STREETINT')
        row = [outlet, item['LIBNAME'].strip(), clean(item['ADDRESS']), clean(item['CITY']),
                     item['STABR'].strip(), clean(item['ZIP']), round(lat, 6), round(lng, 6)]
        if approximate:
            row.append('approximate')
        rows.append(row)
    if len({r[0] for r in rows}) != len(rows) or len(rows) < 15000:
        raise ValueError('Incomplete or duplicate library records')
    rows.sort(key=lambda r:r[0])
    return rows

def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('source',type=Path)
    archive = args.parse_args().source
    with ZipFile(archive) as data:
        member = next(n for n in data.namelist() if 'outlet' in n.lower() and n.lower().endswith('.csv'))
        content = data.read(member)
    try:
        text = content.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = content.decode('cp1252')
    rows = convert(csv.DictReader(io.StringIO(text)))
    result = {'meta':{'title':'IMLS Public Libraries Survey', 'surveyLabel':'IMLS FY 2024',
                      'sourceUrl':REFERENCE, 'downloadUrl':SOURCE, 'year':2024, 'type':'library',
                      'scope':'Geolocated central and branch library outlets, excluding reported temporary closures.',
                      'count':len(rows)}, 'rows':rows}
    OUTPUT.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n', encoding='utf-8')
    print(f'{len(rows):,} library outlets in {len({r[4] for r in rows})} states and jurisdictions')

if __name__ == '__main__':
    main()
