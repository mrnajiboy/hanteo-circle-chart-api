# Hanteo / Circle API Wrapper

[![npm version](https://img.shields.io/npm/v/hanteo-circle-chart-api?color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/hanteo-circle-chart-api)
[![npm downloads](https://img.shields.io/npm/dm/hanteo-circle-chart-api?color=cb3837&logo=npm)](https://www.npmjs.com/package/hanteo-circle-chart-api)
[![CI](https://github.com/mrnajiboy/hanteo-circle-chart-api/actions/workflows/ci.yml/badge.svg)](https://github.com/mrnajiboy/hanteo-circle-chart-api/actions/workflows/ci.yml)
[![Socket Security](https://socket.dev/api/badge/npm/package/hanteo-circle-chart-api)](https://socket.dev/npm/package/hanteo-circle-chart-api)
[![License](https://img.shields.io/github/license/mrnajiboy/hanteo-circle-chart-api)](LICENSE)

A lightweight Node/Express JSON wrapper around public Hanteo and Circle Chart web/XHR endpoints.

It normalizes provider-specific route behavior, current issue selection, issue timestamps, and historic override handling into stable versioned REST routes with a consistent JSON response shape.

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Project structure](#project-structure)
- [Versioning](#versioning)
- [Quickstart](#quickstart)
- [Response model](#response-model)
- [Provider-specific behavior](#provider-specific-behavior)
- [Endpoints](#endpoints)
  - [Hanteo](#hanteo)
  - [Circle](#circle)
- [Normalized entry fields](#normalized-entry-fields)
- [Extra Hanteo metadata](#extra-hanteo-metadata)
- [Logging](#logging)
- [Development](#development)
- [Implementation notes](#implementation-notes)
- [Technical notes](#technical-notes)

---

## Overview

This wrapper is intended for consumers who want a stable programmatic interface over Hanteo and Circle chart data without having to re-implement:

- changing upstream route patterns
- current issue selection logic
- current-vs-historic parameter handling
- provider-specific default-value/date helper behavior
- inconsistent upstream response shapes
- issue timestamp formatting

It exposes chart endpoints as predictable REST routes and returns a normalized JSON structure suitable for ingestion, warehousing, analytics, or automation.

---

## Features

- Stable versioned REST wrapper for **Hanteo** and **Circle**
- Multi-version routing — all supported API versions are mounted simultaneously
- Separate `chart_datetime` and `fetched_at`
- Hanteo `lang` support
- Hanteo World regional charts (US/JP/CN) normalize `targetName` to extract artist name only
- Hanteo social weekly/monthly support
- Placeholder endpoints for future Hanteo star/authentication support
- Circle current-mode issue selection using provider-specific helper endpoints
- Historic override support where upstream allows it
- Configurable provider-aware logging
- Retail hourly support with current KST hour fallback
- Preserves provider-native IDs where available
- Preserves extra Hanteo cross-chart metadata where available
- Consistent issue-time normalization to ISO UTC

---

## Project structure

```
server.mjs                  # Thin bootstrap — mounts all versioned routers
src/
  config/
    apiVersion.mjs          # Version resolver: SUPPORTED_VERSIONS, ACTIVE_VERSION
  utils/
    logging.mjs             # Shared logging system
    helpers.mjs             # Shared utility functions (date helpers, formEncode, etc.)
  routes/
    v1.mjs                  # v1 router — all Hanteo + Circle routes and provider logic
package.json
eslint.config.mjs
.prettierrc
```

---

## Versioning

This API uses URL-based versioning. All endpoints are prefixed with the version number (`/v1/`, `/v2/`, etc.).

### How versioning works

- **`src/config/apiVersion.mjs`** is the single source of truth
- `SUPPORTED_VERSIONS` lists all implemented versions — each is mounted simultaneously at startup
- `ACTIVE_VERSION` / `DEFAULT_VERSION` is the recommended current version surfaced in the discovery endpoint
- Clients can call **any mounted version** independently — e.g., `/v1/...` and `/v2/...` can coexist

### Changing the default/recommended version

Set the `API_VERSION` environment variable, or update `DEFAULT_VERSION` in `src/config/apiVersion.mjs`:

```bash
API_VERSION=v2 node server.mjs
```

### Adding a new version

1. Create `src/routes/v2.mjs` (must export a default `express.Router()`)
2. Add `"v2"` to `SUPPORTED_VERSIONS` in `src/config/apiVersion.mjs`
3. Update `DEFAULT_VERSION` to `"v2"` when ready to make it the recommended version

### Discovery endpoint

```bash
GET /
```

Returns the active version and all mounted versions:

```json
{
  "status": "ok",
  "service": "Hanteo / Circle Chart API",
  "active_version": "v1",
  "supported_versions": ["v1"],
  "docs": "/v1/"
}
```

---

## Quickstart

All chart endpoints are prefixed with the version. The current version is `v1`.

### Hanteo examples

```bash
# Album daily
curl "https://your-service-domain.com/v1/hanteo/album/daily"

# Digital realtime
curl "https://your-service-domain.com/v1/hanteo/digital/real"

# World weekly (US) — artist name only, album title stripped
curl "https://your-service-domain.com/v1/hanteo/world/us/weekly"

# World weekly (global) — raw targetName preserved
curl "https://your-service-domain.com/v1/hanteo/world/global/weekly"

# Social weekly
curl "https://your-service-domain.com/v1/hanteo/social/weekly"

# Hanteo with language override
curl "https://your-service-domain.com/v1/hanteo/album/daily?lang=KO"
```

### Circle examples

```bash
# Social weekly
curl "https://your-service-domain.com/v1/circle/social/weekly"

# Global monthly
curl "https://your-service-domain.com/v1/circle/global/monthly"

# Digital weekly
curl "https://your-service-domain.com/v1/circle/digital/weekly"

# Album first-half
curl "https://your-service-domain.com/v1/circle/album/firsthalf"

# Retail hour (current-mode)
curl "https://your-service-domain.com/v1/circle/retail/hour"
```

### Historic examples

```bash
# Circle social weekly issue by period key
curl "https://your-service-domain.com/v1/circle/social/weekly?period_key=202608"

# Circle global daily by explicit issue date
curl "https://your-service-domain.com/v1/circle/global/daily?yyyymmdd=20260304"

# Circle retail hour by explicit date/hour
curl "https://your-service-domain.com/v1/circle/retail/hour?yyyymmdd=20260307&thisHour=21"

# Circle digital weekly by explicit issue params
curl "https://your-service-domain.com/v1/circle/digital/weekly?hitYear=2026&targetTime=10&yearTime=3"
```

---

## Response model

### Top-level shape

Most wrapper endpoints return a structure like:

```json
{
  "chart_datetime": "2026-03-07T00:00:00.000Z",
  "fetched_at": "2026-03-07T03:40:01.000Z",
  "provider": "circle",
  "chart_type": "global",
  "entries": []
}
```

Depending on provider and route family, the response may also include:

- `chart_name`
- `category`
- `timeframe`
- `region`
- `week_label`
- `chart_type`
- `term`
- `termGbn`
- `serviceGbn`
- `yyyymmdd`
- `period_key`
- `hitYear`
- `targetTime`
- `yearTime`
- `thisHour`
- `result_status`

### Core semantics

- `chart_datetime` = **issue time / issue period anchor**
- `fetched_at` = wrapper retrieval time
- `entries[]` = normalized chart rows
- `result_status` = Circle upstream status, when present

### Timestamp semantics by chart family

The wrapper normalizes issue timestamps into UTC ISO strings:

- daily → issue day at midnight UTC
- weekly → issue period anchor, generally start-of-period
- monthly → first day of month UTC
- yearly → Jan 1 UTC
- firsthalf → Jan 1 UTC of the issue year
- retail hourly → KST hour converted to UTC

---

## Provider-specific behavior

## Hanteo

### Behavior

- Uses Hanteo's native issue timestamp where possible
- Defaults to `lang=EN`; supports `?lang=` override
- Derives stable issue timestamps when upstream issue time is missing or unparseable
- Preserves provider-native IDs when available

### World regional artist name normalization

For US, JP, and CN world charts the raw `targetName` field from the upstream API contains both artist and album name formatted as `"<artist> - <album title>"`. The wrapper strips everything from the last `-` onwards to return only the artist name:

| Raw `targetName`                             | Normalized `artist` |
| -------------------------------------------- | ------------------- |
| `하이키(H1-KEY) - LOVECHAPTER: 미니앨범 5집` | `하이키(H1-KEY)`    |
| `최예나(YENA) - LOVE CATCHER: 미니앨범 5집`  | `최예나(YENA)`      |
| `진 - Echo: 미니앨범 2집`                    | `진`                |
| `ofijeo - - Crazy`                           | `ofijeo -`          |

The global world chart (`/v1/hanteo/world/global/...`) is not affected and returns `targetName` as-is.

### Supported Hanteo categories

- album
- digital
- world (global, us, jp, cn)
- social

### Planned / placeholder categories

- star
- authentication

---

## Circle

### Behavior

Circle issue selection is handled by chart-family-specific helper logic rather than one universal resolver. This is because upstream Circle behavior differs by family.

### Current issue sources by family

#### Social

Uses `/data/api/chart_func/social/v3/datelist`

#### Global

Uses `/data/api/chart_func/global/datelist` when available, falls back to `/data/api/chart_func/global/default_value`

#### On/Off family

Uses fully parameterized requests with current issue params derived from the resolved current global issue.

Families: digital, streaming, download, bgm, vcoloring, singingroom, bell, ring

#### Retail non-hourly

Uses `/data/api/chart_func/retail/default_value`

#### Retail hourly

Uses `/data/api/chart_func/retail/hour_time`

#### Album

No default helper endpoint. Current issue params are derived by wrapper logic.

### Timestamp normalization

- day → issue day at UTC midnight
- week → issue period anchor
- month → first day of month UTC
- year / firsthalf → Jan 1 UTC

---

## Endpoints

All endpoints below are prefixed with `/v1`. For future versions substitute `/v2`, etc.

# Hanteo

## Album

```
GET /v1/hanteo/album/:timeframe
```

Timeframes: `real` `daily` `weekly` `monthly` `yearly`

---

## Digital

```
GET /v1/hanteo/digital/:timeframe
```

Timeframes: `real` `daily` `weekly` `monthly` `yearly`

---

## World

```
GET /v1/hanteo/world/:region/:timeframe
```

Regions: `global` `us` `jp` `cn`  
Timeframes: `weekly` `monthly` `yearly`

> **Note:** US, JP, and CN entries have `artist` normalized to strip the album title suffix. Global entries return `targetName` as-is.

---

## Social

```
GET /v1/hanteo/social/:timeframe
```

Timeframes: `weekly` `monthly`

---

## Star — coming soon

```
GET /v1/hanteo/star/:timeframe
```

---

## Authentication — coming soon

```
GET /v1/hanteo/authentication/:timeframe
```

---

# Circle

## Social

```
GET /v1/circle/social/:timeframe
```

Timeframes: `weekly` `monthly` `yearly`  
Historic override: `?period_key=YYYYWW|YYYYMM|YYYY`

---

## Global

```
GET /v1/circle/global/:timeframe
```

Timeframes: `daily` `weekly` `monthly` `yearly`  
Historic override: `?yyyymmdd=`

---

## On/Off family

```
GET /v1/circle/digital/:timeframe
GET /v1/circle/streaming/:timeframe
GET /v1/circle/download/:timeframe
GET /v1/circle/bgm/:timeframe
GET /v1/circle/vcoloring/:timeframe
GET /v1/circle/singingroom/:timeframe
GET /v1/circle/bell/:timeframe
GET /v1/circle/ring/:timeframe
```

| Chart       | Timeframes              |
| ----------- | ----------------------- |
| digital     | weekly, monthly, yearly |
| streaming   | weekly, monthly, yearly |
| download    | weekly, monthly, yearly |
| bgm         | weekly, monthly         |
| vcoloring   | weekly, monthly, yearly |
| singingroom | weekly, monthly         |
| bell        | weekly, monthly         |
| ring        | weekly, monthly         |

Historic overrides: `?hitYear=` `?targetTime=` `?yearTime=`

---

## Album

```
GET /v1/circle/album/:timeframe
```

Timeframes: `weekly` `monthly` `firsthalf` `yearly`  
Historic overrides: `?hitYear=` `?targetTime=` `?yearTime=`

---

## Retail hour

```
GET /v1/circle/retail/hour
```

Historic overrides: `?yyyymmdd=YYYYMMDD` `?thisHour=HH`

---

## Retail day/week/month/year

```
GET /v1/circle/retail/:timeframe
```

Timeframes: `daily` `weekly` `monthly` `yearly`  
Historic override: `?yyyymmdd=`

---

## Normalized entry fields

Common fields across routes:

- `rank`, `rank_diff`
- `title` / `album` / `name`
- `artist`, `artist_global_name`
- `image`
- `sales`, `supply_price`, `value`, `score`, `cumulative_score`
- `distribution`, `production`, `badge`
- `rank_change`, `rank_status`, `rank_high`, `rank_continue`
- `youtube_id`, `youtube_title`
- `provider_item_id`, `provider_artist_id`, `provider_album_id`

The exact set depends on provider and chart family.

---

## Extra Hanteo metadata

Some Hanteo responses expose upstream cross-platform score data. When available, entries include:

```json
"cross_chart_scores": {
  "melon_score": 0,
  "melon_rank": 0,
  "melon_song_id": null,
  "bugs_score": 0,
  "bugs_rank": 0,
  "bugs_song_id": null,
  "genie_score": 101.0,
  "genie_rank": 99,
  "genie_song_id": "111564225",
  "flo_score": 7979.8,
  "flo_rank": 21,
  "flo_song_id": "553308720",
  "collect_song_name": "ULSSIGU",
  "collect_album_name": "IM HERO 2",
  "collect_artist_name": "Lim Young-Woong"
}
```

---

## Logging

### Environment variables

| Variable           | Scope                |
| ------------------ | -------------------- |
| `LOG_LEVEL`        | Global default       |
| `LOG_LEVEL_HANTEO` | Hanteo provider only |
| `LOG_LEVEL_CIRCLE` | Circle provider only |

Allowed values: `SILENT` `ERROR` `WARN` `INFO` `DEBUG` `VERBOSE`

### Examples

```bash
LOG_LEVEL=WARN node server.mjs
LOG_LEVEL=VERBOSE node server.mjs
LOG_LEVEL_HANTEO=ERROR LOG_LEVEL_CIRCLE=DEBUG node server.mjs
```

### Log format

```
[LEVEL][provider:tag] message
```

---

## Development

### Runtime

- Node.js (ES modules — `"type": "module"`)
- Express

### Install

```bash
npm install
```

### Start

```bash
npm start
```

### Lint

```bash
# Check for issues
npm run lint

# Auto-fix fixable issues
npm run lint:fix
```

### Format

```bash
# Format all files
npm run format

# Check formatting without writing
npm run format:check

# Do lint + prettier format all at once.
npm run cleanup 
```

### Tooling config files

| File                | Purpose                        |
| ------------------- | ------------------------------ |
| `eslint.config.mjs` | ESLint flat config (v9+)       |
| `.prettierrc`       | Prettier formatting rules      |
| `.prettierignore`   | Files excluded from formatting |

---

## Implementation notes

- Hanteo defaults to `lang=EN`
- Circle does not expose a general language parameter
- Circle current issue selection is family-specific
- Global uses `default_value` fallback when datelist is unavailable
- Social uses its own datelist endpoint
- On/Off uses fully parameterized requests derived from current global issue
- Retail non-hourly uses `default_value`; hourly uses `hour_time`
- Album has no default helper endpoint — wrapper derives params itself
- Retail hourly defaults to current KST hour when `thisHour` is omitted
- Provider-native IDs are preserved where upstream exposes them
- Extra Hanteo cross-chart data is preserved as optional metadata

---

## Technical notes

### Hanteo upstream base

```
https://api.hanteochart.io
```

Routes used:

```
/v4/ranking/list/ALBUM/WEEKLY/BASIC
/v4/ranking/list/SOUND/MONTHLY/BASIC
/v4/ranking/list/WORLD/WEEKLY
/v4/ranking/list/SOCIAL/MONTHLY/BASIC
```

### Circle upstream base

```
https://circlechart.kr
```

Different chart families use different issue-resolution sources — see [Provider-specific behavior → Circle](#circle) above.

### Why some daily Circle routes are absent

Current upstream Circle behavior no longer exposes daily issues uniformly across all on/off families. The wrapper only exposes daily routes where they are currently valid upstream: `global` and `retail`.

### Consumer expectations

Downstream consumers should treat:

- `chart_datetime` as the canonical issue anchor
- `fetched_at` as retrieval time
- `result_status` as optional upstream provider status

---

## License / usage note

MIT, but I'd recommned internal or personal use only.
