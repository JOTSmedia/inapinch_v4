# IN A PINCH V4 · U.S. Restroom Atlas

V4 includes 1,438,527 community-mapped stops across all 50 states, Washington, DC, and the five inhabited U.S. territories. Pan or zoom to see stops in the part of the country on screen. **Browse destinations** jumps to a state, territory, or one of 24 themed city guides. **U.S. atlas** returns to the national overview.

## Open the site

- **On your computer** — Extract the entire ZIP and double-click **OPEN_ME.html** in a modern browser. Keep the `assets/` and `data/` folders beside it. The national directory is divided into small geographic files that the page reads as you move. Street tiles, neighborhood updates, external business listings and directions use the internet.
- **Local preview with location access** — Run `python3 -m http.server 8080` in the extracted folder, then open `http://localhost:8080`. Browsers handle geolocation most reliably on localhost or HTTPS. You can pan and choose destinations regardless of the permission decision.
- **GitHub Pages** — Place the contents of `IN_A_PINCH_V4_GITHUB_UPLOAD/` in the branch and directory served by Pages. Keep `index.html`, the JavaScript and CSS files, `scripts/`, `assets/`, and the complete `data/` tree in their original relative locations. To keep an earlier site at its current URL, put this edition in a sibling `v4/` folder. The static site needs no build step or map API key.

## Find a stop

1. Allow location access on a fresh visit, use **Find near me**, or choose a destination. The map can center on a U.S. location outside the featured cities. A shared place link opens at its destination.
2. At country or state scale, tap a numbered group to explore that area. Zoom in for individual pins and a searchable list. The map loads the saved geographic blocks for the new view and can add public OpenFreeMap points at neighborhood zoom. If loading fails, the status offers **Retry**. A sparsely mapped area can genuinely have no matching stops.
3. Select a pin or list entry for access details, source links and directions. Roadside facilities open driving directions. Restaurants and bars have Google Maps searches using their name and address or mapped coordinates. Saved stops stay in the visitor’s browser.

### Road trips and showers

**Gas & rest stops** includes mapped fuel stations, travel centers, truck stops, service areas and rest areas. **Showers** requires an explicit shower field or mapped shower facility. Select both filters to find roadside places with shower evidence. Details show the operator link and shower count when supplied. Ask the location about fees, hours and availability.

**Mapped bathrooms**, **Free & public**, **Accessible**, and **Open by schedule** each require their own evidence. An ordinary restaurant, gas station or public library listing is a place to ask. Its presence alone establishes neither public bathroom access nor a shower.

## What ships in V4

| Data | Source and scope |
| --- | --- |
| U.S. area boundaries | Bundled 2026 U.S. Census Bureau TIGERweb geometry covers all 56 state-equivalent destinations. It supports local state lookup and navigation across the Alaska dateline. |
| Nationwide mapped stops | The November 2026 community map includes 81,108 mapped restroom records and 114,876 roadside records. Mapped categories include restrooms, fuel, rest areas, food and drink businesses, convenience stores, supermarkets, shopping centers and other visitor facilities. Geofabrik extracts supply the main atlas. OpenFreeMap tiles from November 15 supply islands in Guam, the Northern Mariana Islands, American Samoa and the U.S. Virgin Islands. The source manifest lists the individual extracts. |
| Public libraries | The FY 2024 IMLS Public Libraries Survey contributes 16,823 geolocated central and branch outlets. Branch addresses and coordinate precision come from the survey. |
| Travel-center amenities | The November 21, 2026 Love’s, Pilot/Flying J and TravelCenters of America/Petro directories supply 1,919 U.S. location records. Of these, 1,591 list showers at the specific site. Details link to the operator. |
| Federal truck parking | The FHWA/BTS National Transportation Atlas Database adds 1,915 facilities in the contiguous states. Its April 9, 2019 inventory includes rest areas, visitor centers, service plazas and other truck facilities. Individual shower availability, bathroom access and current operations require separate evidence. |
| Themed city guides | The 24 existing guides contribute 27,431 entries, including authored restroom notes and November 15, 2026 community-map snapshots. City-specific Wireframe palettes and the lighter Daylight style are retained. |

The national catalog records counts by state, category and geographic block. Sources can describe the same building, so adding their totals would double-count some places. Coverage depends on what contributors and operators have mapped. Remote areas and newly opened businesses can have fewer records. Use a stop's source for details. [National directory counts](data/atlas-catalog.json) · [National import sources](data/atlas-sources.json) · [City guide coverage](data/coverage.json)

## Shared ratings

The map, listings, filters, bookmarks, links and directions work with static hosting. Shared ratings use the included Cloudflare Worker and D1 database for allowlisted city-guide entries. Nationwide listings can display their sources and amenities independently of the ratings service. The backend guide describes the Worker and database setup. [Backend deployment instructions](README_BACKEND.md#deploy-to-cloudflare-workers)

## Maintaining this edition

- `data/atlas/` contains the geographic chunks. Keep them with `data/atlas-catalog.json`. `national-venues.js` loads matching chunks for the viewport.
- `data/national-libraries.json` and the `data/travel-*.json` files supply the supplemental U.S. directories. `national-index.js` joins these sources for display.
- `cities.json` defines each guide. The full city records live in `data/<city>.json`. `locations.json` is the compact **city-guide index** used to build the ratings allowlist. The nationwide dataset lives under `data/`.
- `us-geography.js` identifies U.S. regions. `us-viewport.js` handles neighborhood updates, cancellations and load status. `cartography.js` and `vector-map.js` draw the geographic basemap and labels.
- Run `npm test` for the automated checks. Run `node scripts/build-portable.mjs` after changing the frontend or directories to refresh **OPEN_ME.html**. `node scripts/prepare-public.mjs` stages the static files and refreshes the allowlist for the framework build.

Public map sources and bundled software retain their respective attributions and licenses. [Third-party notices](THIRD_PARTY_NOTICES.md)
