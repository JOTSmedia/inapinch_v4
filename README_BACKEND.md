# IN A PINCH

> **V4 deployment note.** This guide preserves the original Key West server setup. The deployment and D1 sections apply to the shared ratings backend. For the nationwide atlas, current coverage, and static publishing instructions, use the [V4 README](README.md).

**when you gotta go, you gotta go**

A colorful, mobile-friendly bathroom finder for Key West, Florida. Real aerial water footage sits beneath an interactive geographic map. The app includes access filters, venue notes, directions, saved places, and anonymous shared bathroom ratings.

[Current live app](https://in-a-pinch-key-west.fuzzyjackets.chatgpt.site/)

## What's included

- Interactive Leaflet map with local OpenStreetMap geographic data and clustered pins.
- 152 mapped stops: 18 with restroom evidence and 134 additional bar/restaurant leads marked bathroom unconfirmed.
- Free/public, purchase likely, accessible, published-hours, and confirmed-bathroom filters.
- Search, optional browser location, walking directions, and saved places.
- Shared 1–5-star ratings without accounts; visitors can update or remove their own vote.
- Actual-water video loop plus a 4:20 background cut from the supplied video's 0:15–4:35 section.
- Responsive map/list layouts, video pause controls, and reduced-motion support.
- Server API, database schema/migration, automated tests, and GitHub Actions CI.

This ZIP is an independent repository export. Its frontend, data, and ratings behavior match the live app, with portable Cloudflare configuration instead of the original managed hosting integration. It contains no production credentials or database records.

## Upload this folder to GitHub

This folder is **IN_A_PINCH_GITHUB_UPLOAD**. The real application **index.html is directly at the top level**, alongside its CSS, JavaScript, location data, and `assets/` directory. The page is not a redirect or a placeholder.

1. Extract `IN_A_PINCH_GITHUB_UPLOAD.zip`.
2. Open the `IN_A_PINCH_GITHUB_UPLOAD` folder.
3. Open your GitHub repository, choose **Add file → Upload files**, and upload this folder's **contents**.
4. Commit the upload. `index.html` must appear immediately when you open the repository's main file listing. Keep `assets/`, `app/`, and the other folders intact.

Do not upload only the ZIP, only `index.html`, or the enclosing `IN_A_PINCH_GITHUB_UPLOAD` folder. The files **inside** that folder belong at the repository root. Include `.nojekyll`, `.gitignore`, `.nvmrc`, and `.github`; GitHub Desktop or Git makes it easier to include hidden files.

### Publish the map with GitHub Pages

After the upload, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, choose **main** and **/(root)**, then **Save**. Use your actual default branch if it has a different name. GitHub will display the published website URL after deployment.

The map, search, filters, saved stops, location button, directions, and video backgrounds are static and can run on GitHub Pages. Relative frontend paths also work at a project URL such as `https://YOUR_USERNAME.github.io/YOUR_REPOSITORY/`.

**Shared bathroom ratings require the included backend.** GitHub Pages does not execute the ratings API, so the static-only version shows ratings as unavailable. Votes have not been replaced with local-only ratings or fabricated community scores. To enable shared ratings, deploy the complete repository to Cloudflare Workers + D1 using the instructions below. This keeps the frontend and API on the same origin.

Official GitHub instructions: [Configure a Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and [Place index.html at the top level](https://docs.github.com/en/pages/getting-started-with-github-pages/troubleshooting-404-errors-for-github-pages-sites).

### Optional: upload with Git

From inside the extracted folder:

```sh
git init
git add .
git commit -m "Initial IN A PINCH app"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Replace `YOUR_GITHUB_REPOSITORY_URL` with the URL of an empty repository you own.

## Run locally

For a static preview without installing Node packages, run `python3 -m http.server 8080` from this folder and open `http://localhost:8080`. Use an HTTP server rather than double-clicking the file because the map loads JavaScript modules and JSON data. Shared ratings need the full app below.

### Full app with shared ratings

Use **Node.js 24** (recommended; `.nvmrc` is included) and npm. The minimum supported Node version is 22.13.0.

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Open **http://127.0.0.1:5173**. No map API key, Cloudflare login, or ChatGPT account is needed for local development.

The first migration creates a local SQLite-backed D1 database beneath `.wrangler/state`. That folder is excluded from Git. Local ratings are separate from the live app's ratings. Run the migration before trying to submit ratings.

### Verify and build

```sh
npm test
npm run build
npm run preview
```

The `predev` and `prebuild` scripts copy the known frontend files from the repository root into a generated `public/` staging directory. Edit the root files; do not edit generated `public/`. This lets the same source run directly on GitHub Pages and through the full application server. Only the frontend files are staged, so backend source files are not copied into the production static asset directory.

The production build creates `dist/client` and `dist/server`. The preview command serves the compiled Worker locally and prints its URL. Generated build output and dependencies are intentionally excluded from the ZIP and repository.

## Deploy to Cloudflare Workers

The included configuration uses **Cloudflare Workers + D1**. GitHub stores the source; GitHub Pages alone cannot run the shared ratings API.

1. Install dependencies with `npm ci`.
2. Sign in to your own Cloudflare account:

   ```sh
   npx wrangler login
   npx wrangler d1 create in-a-pinch-ratings
   ```

3. Copy the returned `database_id` into the `DB` entry in `wrangler.jsonc`, replacing the local placeholder. You can also change the Worker name there.
4. Create the remote schema and deploy:

   ```sh
   npm run db:migrate:remote
   npm run deploy
   ```

The migration scripts explicitly use the root `wrangler.jsonc`. Deployment uses the generated `dist/server/wrangler.json`, which includes the built asset directory. After changing the D1 ID, rebuild before deploying.

The included GitHub Actions workflow tests and builds on pushes and pull requests. It does **not** deploy automatically or require deployment secrets. Keep API tokens in your hosting provider or GitHub Actions secrets if you add deployment automation later.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Application markup and brand text |
| `app.js` | Map, directory, filters, details, saved stops, location |
| `locations.json` | Listings, coordinates, evidence, access notes and sources |
| `island-map.js` | Geographic map styling |
| `ratings.js` | Anonymous rating interface and API client |
| `ocean.js` / `ocean.css` | Actual-footage backgrounds and playback controls |
| `tropic-theme.css` | Typography and Key West palette |
| `assets/` | Videos, posters, geographic data, and vendored map libraries |
| `app/api/ratings/route.ts` | GET/POST/DELETE ratings endpoint |
| `server/ratings.ts` | Validation, anonymous browser cookie, aggregation and updates |
| `db/schema.ts` / `drizzle/` | D1 schema and migrations |
| `tests/` | Directory and ratings tests |
| `vite.config.ts` / `wrangler.jsonc` | Portable build and hosting configuration |
| `scripts/prepare-public.mjs` | Stages root frontend files for the full app build |
| `START_HERE.txt` | Short GitHub upload checklist |

## Editing the directory

Update `locations.json` to add or correct a location. Keep IDs stable because ratings are keyed by place ID. Each entry should include its source URLs and distinguish confirmed restroom information from assumptions about a venue.

The map is a growing directory, not an exhaustive census. "Open by schedule" uses published restroom hours in `America/New_York`; it is not live access monitoring. Facility pins can be approximate. Accessibility is shown only when the source describes the restroom itself. Source-review metadata is included in the dataset.

## Ratings and privacy

The server issues an anonymous, HTTP-only browser cookie. Each browser can submit one rating per bathroom and then update or remove it. Scores are validated server-side and shared averages are stored in D1. Clearing cookies or switching browsers resets recognition; this is not one-person identity verification.

The application does not require names, email addresses, or accounts. Location stays in the page; saved places stay in browser storage. Directions open Google Maps. Fonts load from Google Fonts. Standard hosting access logs are controlled by your hosting provider.

## Video backgrounds

Both loops are already included, silent, and encoded as H.264 MP4 with fast-start metadata:

- `assets/key-west-background.mp4`: 4:20, from source 0:15 through 4:35; the final 1.25 seconds dissolve back to the first frame.
- `assets/ocean-water.mp4`: 6 seconds of actual reef water, cropped from source 0:20.5–0:26.5; the last 0.55 seconds dissolve back to the first frame.

The map's water footage is decorative, not a georeferenced satellite layer. `video-sources.json` records the edit ranges and crop. The uploaded source was 1280×720 despite its filename; the web loops are 960×540. Poster images appear when motion is disabled or video is unavailable.

## Third-party material

See `THIRD_PARTY_NOTICES.md` and `licenses/` for map-library licenses and data attribution. User-supplied images and video are not granted an open-source license by this export. No license has been selected for the original application code; the repository owner can add one.
