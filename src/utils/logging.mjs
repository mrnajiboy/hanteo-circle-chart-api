// ============================================================================
// LOGGING SYSTEM
// ============================================================================

export const LOG_LEVELS = {
  SILENT: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
  VERBOSE: 5,
};

export function parseLogLevel(s) {
  const upper = String(s || "").toUpperCase();
  return LOG_LEVELS[upper] ?? LOG_LEVELS.INFO;
}

export const GLOBAL_LOG_LEVEL = parseLogLevel(process.env.LOG_LEVEL || "INFO");
export const HANTEO_LOG_LEVEL = parseLogLevel(
  process.env.LOG_LEVEL_HANTEO || process.env.LOG_LEVEL || "INFO"
);
export const CIRCLE_LOG_LEVEL = parseLogLevel(
  process.env.LOG_LEVEL_CIRCLE || process.env.LOG_LEVEL || "INFO"
);

function shouldLog(provider, level) {
  const targetLevel = provider === "hanteo" ? HANTEO_LOG_LEVEL : CIRCLE_LOG_LEVEL;
  const levelNum = LOG_LEVELS[level.toUpperCase()] ?? LOG_LEVELS.INFO;
  return levelNum <= targetLevel;
}

export function log(provider, level, tag, ...args) {
  if (!shouldLog(provider, level)) return;
  console.log(`[${level.toUpperCase()}][${provider}:${tag}]`, ...args);
}

export const logError = (p, t, ...a) => log(p, "ERROR", t, ...a);
export const logWarn = (p, t, ...a) => log(p, "WARN", t, ...a);
export const logInfo = (p, t, ...a) => log(p, "INFO", t, ...a);
export const logDebug = (p, t, ...a) => log(p, "DEBUG", t, ...a);
export const logVerbose = (p, t, ...a) => log(p, "VERBOSE", t, ...a);
