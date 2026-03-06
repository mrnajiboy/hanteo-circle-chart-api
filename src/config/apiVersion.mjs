// ============================================================================
// API VERSION CONFIGURATION
// ============================================================================
// To change the active API version:
//   • Set the API_VERSION environment variable (e.g. API_VERSION=v2), OR
//   • Update DEFAULT_VERSION below.
//
// When a new version is ready, add it to SUPPORTED_VERSIONS and create the
// corresponding router at src/routes/<version>.mjs.
// ============================================================================

/** All API versions this server knows about, in ascending order. */
export const SUPPORTED_VERSIONS = ["v1"];

/** Default active version used when API_VERSION env var is not set. */
const DEFAULT_VERSION = "v1";

/**
 * The recommended/default API version surfaced in the root discovery endpoint.
 * All versions in SUPPORTED_VERSIONS are mounted simultaneously — ACTIVE_VERSION
 * does NOT restrict which versions clients can call. Override with API_VERSION
 * env var (e.g. API_VERSION=v2) to change the default recommendation.
 * Throws at boot time if API_VERSION is set to an unknown value.
 */
export const ACTIVE_VERSION = (() => {
  const v = process.env.API_VERSION || DEFAULT_VERSION;
  if (!SUPPORTED_VERSIONS.includes(v)) {
    throw new Error(
      `Unsupported API_VERSION "${v}". Supported versions: ${SUPPORTED_VERSIONS.join(", ")}`
    );
  }
  return v;
})();

/** URL prefix for the active version, e.g. "/v1". */
export const VERSION_PREFIX = `/${ACTIVE_VERSION}`;

/**
 * Returns true if the given version string is in the supported list.
 * @param {string} v
 */
export function isSupportedVersion(v) {
  return SUPPORTED_VERSIONS.includes(String(v));
}
