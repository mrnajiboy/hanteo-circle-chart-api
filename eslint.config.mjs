import js from "@eslint/js";
import globals from "globals";
import prettierConfig from "eslint-config-prettier";

export default [
  // Apply recommended JS rules to all project source files
  {
    files: ["**/*.mjs", "**/*.js"],
    ...js.configs.recommended,
  },

  // Environment globals — Node.js (process, console, __dirname, etc.)
  // plus modern web globals available in Node 18+ (fetch, URL, etc.)
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        // Node 18+ built-in web globals
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Headers: "readonly",
        Request: "readonly",
        Response: "readonly",
      },
    },
  },

  // Disable ESLint formatting rules that would conflict with Prettier
  prettierConfig,

  // Project-specific rule overrides
  {
    files: ["**/*.mjs", "**/*.js"],
    rules: {
      // Allow unused vars prefixed with _ (common for ignored destructure slots)
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Prefer const where reassignment doesn't occur
      "prefer-const": "warn",
      // This project uses console intentionally for structured logging
      "no-console": "off",
    },
  },

  // Ignore generated/dependency directories
  {
    ignores: ["node_modules/**"],
  },
];
