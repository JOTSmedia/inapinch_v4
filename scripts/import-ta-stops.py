"""Build data/travel-ta.json from the public TravelCenters of America XLSX export.

python3 scripts/import-ta-stops.py /path/to/download.xlsx --checked YYYY-MM-DD
Source: https://www.ta-petro.com/api/locationsdata/download/
"""
import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

SOURCE = 'https://www.ta-petro.com/api/locationsdata/download/'
DIRECTORY = 'https://www.ta-petro.com/location/all-locations/'
STATE_NAMES = ('Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|'
               'District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|'
               'Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|'
               'Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|'
               'New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|'
               'Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|'
               'Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming').split('|')
STATE_CODES = dict(zip(STATE_NAMES,'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY '
                       'LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI '
                       'SC SD TN TX UT VT VA WA WV WI WY'.split()))

def workbook_rows(path):
    # Use the column addresses, since empty spreadsheet cells are omitted.
    with ZipFile(path) as archive:
        strings = [''.join(s.itertext()) for s in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
    columns = {}
    for number, element in enumerate(sheet.findall('.//{*}sheetData/{*}row')):
        row = {}
        for cell in element.findall('{*}c'):
            value = cell.findtext('{*}v')
            if value is None:
                continue
            if cell.get('t') == 's':
                value = strings[int(value)]
            col = re.sub(r'[0-9]+', '', cell.attrib['r'])
            if number == 0:
                columns[col] = value.strip()
            else:
                row[columns[col]] = value.strip()
        if number:
            yield row

def count_field(row, field):
    value = row.get(field, '')
    if not value:
        return None
    if not value.isdigit():
        raise ValueError(f'Unexpected {field} tally for {row["Site ID"]}: {value}')
    return int(value)

def convert(row, checked):
    state = STATE_CODES.get(row['State'])
    if not state:
        return None
    lat, lng = float(row['Latitude']), float(row['Longitude'])
    if not (18 <= lat <= 72 and -180 <= lng < -60):
        raise ValueError('Unexpected U.S. coordinates for '+row['Location'])
    showers = count_field(row, 'Showers')
    if showers is None:
        shower_note = 'Shower availability is unlisted in the operator directory.'
    elif showers == 0:
        shower_note = 'The operator lists zero showers at this location.'
    else:
        shower_note = f'The operator lists {showers} '+('shower.' if showers == 1 else 'showers.')+' Check with the stop for current availability and fees.'
    city, name, street = row['City'], row['Location'], row.get('Address','')
    address = ', '.join(s for s in (street, city, (state+' '+row.get('Zipcode','')).strip()) if s)
    return {
        'id':'us-ta-'+row['Site ID'], 'cityId':'us', 'name':name, 'category':'Truck stop',
        'state':state, 'locality':city, 'lat':lat, 'lng':lng, 'address':address,
        'addressKnown':bool(street), 'neighborhood':city+', '+state,
        'coordinateAccuracy':'facility', 'priority':35, 'roadside':True,
        'showers':None if showers is None else showers > 0, 'showerCount':showers,
        'accessibleShowerCount':count_field(row, 'Handicapped Showers'), 'showerNote':shower_note,
        'access':'unknown', 'bathroomConfirmed':False, 'accessible':None, 'changingTable':None,
        'purchaseLikely':False, 'dynamicListing':True, 'evidenceType':'operator-directory',
        'accessNote':'Ask staff about restroom access and any purchase or entry requirements.',
        'note':'This location is listed by TravelCenters of America. Restroom access and hours are unverified.',
        'phone':row.get('Phone', ''), 'searchTerms':'TA Petro TA Express TravelCenters truck stop travel center highway roadside '+row['Brand'],
        'sources':[{'label':'TravelCenters location directory','url':DIRECTORY},
                   {'label':'Operator amenities spreadsheet','url':SOURCE}],
        'checkedLabel':'TravelCenters of America · '+checked,
    }

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--checked', type=date.fromisoformat, required=True)
    args=parser.parse_args()
    checked=args.checked.isoformat()
    records=[convert(row,checked) for row in workbook_rows(args.source)]
    places=sorted((p for p in records if p),key=lambda p:p['id'])
    if len(places)<250 or len({p['id'] for p in places})!=len(places):
        raise ValueError('Incomplete export or duplicate stop IDs')
    result={'source':SOURCE,'checked':checked,'locations':places}
    dest=Path(__file__).resolve().parents[1]/'data'/'travel-ta.json'
    dest.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(f'{len(places)} U.S. locations in {len({p["state"] for p in places})} states; showers:',Counter(p['showers'] for p in places))

if __name__=='__main__':
    main()
