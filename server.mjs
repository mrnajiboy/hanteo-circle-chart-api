// Load encrypted .env for local development only.
// On hosted platforms (Render, CI, etc.) env vars are injected natively.
const isHosted = process.env.RENDER || process.env.CI || process.env.SERVER_BASE_URL;
if (!isHosted) {
  try {
    const dotenvx = await import("@dotenvx/dotenvx");
    dotenvx.config();
  } catch {
    // dotenvx not installed — env vars must be set manually
  }
}

import express from "express";
import { ACTIVE_VERSION, VERSION_PREFIX, SUPPORTED_VERSIONS } from "./src/config/apiVersion.mjs";
import { GLOBAL_LOG_LEVEL, LOG_LEVELS } from "./src/utils/logging.mjs";

// ============================================================================
// MULTI-VERSION ROUTER MOUNTING
// Every version listed in SUPPORTED_VERSIONS is mounted simultaneously so that
// /v1/..., /v2/..., etc. can all be called by clients at the same time.
//
// ACTIVE_VERSION is the recommended/current version surfaced in the root
// discovery endpoint — it does NOT limit which versions are reachable.
//
// To add a new version:
//   1. Create src/routes/v2.mjs (must export a default express.Router())
//   2. Add "v2" to SUPPORTED_VERSIONS in src/config/apiVersion.mjs
//   3. Update DEFAULT_VERSION in apiVersion.mjs when ready to make it active
// ============================================================================

const versionRouters = await Promise.all(
  SUPPORTED_VERSIONS.map(async (version) => {
    const { default: router } = await import(`./src/routes/${version}.mjs`);
    return { version, router };
  })
);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Request / response logging middleware ────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  if (GLOBAL_LOG_LEVEL >= LOG_LEVELS.INFO) {
    console.log(`[INFO][req] ${req.method} ${req.originalUrl} query=${JSON.stringify(req.query)}`);
  }
  res.on("finish", () => {
    if (GLOBAL_LOG_LEVEL >= LOG_LEVELS.INFO) {
      console.log(
        `[INFO][res] ${req.method} ${req.originalUrl} status=${res.statusCode} ${Date.now() - start}ms`
      );
    }
  });
  next();
});

// ── Root — version discovery ─────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "Hanteo / Circle Chart API",
    active_version: ACTIVE_VERSION,
    supported_versions: SUPPORTED_VERSIONS,
    docs: `${VERSION_PREFIX}/`,
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "Hanteo / Circle Chart API",
    active_version: ACTIVE_VERSION,
    supported_versions: SUPPORTED_VERSIONS,
    docs: `${VERSION_PREFIX}/`,
  });
});

// ── Mount all supported versions ─────────────────────────────────────────────
for (const { version, router } of versionRouters) {
  app.use(`/${version}`, router);
}

// ============================================================================
// START SERVER
// ============================================================================
app.listen(PORT, () => {
  const host = process.env.SERVER_BASE_URL || `http://localhost:${PORT}`;

  console.log("\n" + "=".repeat(60));
  console.log("📊 Hanteo / Circle Chart API");
  console.log("=".repeat(60));
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 URL: ${host}`);
  console.log(`✅ Active (default) version: ${ACTIVE_VERSION}  →  ${VERSION_PREFIX}/`);
  console.log(`📦 Mounted versions: ${SUPPORTED_VERSIONS.map((v) => `/${v}`).join(", ")}`);
  console.log("=".repeat(60) + "\n");
});
