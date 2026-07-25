// Shared env-backed defaults for the whole e2e/langy suite — was duplicated
// across langy-agent.ts and browser-qa.ts, which risked one copy drifting
// from the other and silently breaking auth for whichever adapter kept the
// stale value.

export const APP_BASE =
  process.env.LANGY_APP_URL ??
  "https://app.langy-workspace.langwatch.localhost:1355";
export const PROJECT_ID = process.env.LANGY_PROJECT_ID ?? "local-dev-project";
export const PROJECT_SLUG =
  process.env.LANGY_PROJECT_SLUG ?? process.env.LANGY_PROJECT_ID ?? PROJECT_ID;
export const ADMIN_EMAIL = process.env.LANGY_ADMIN_EMAIL ?? "admin@haven.localhost";
export const ADMIN_PASSWORD =
  process.env.LANGY_ADMIN_PASSWORD ?? "LocalHavenAdmin!2026";
// langwatch-api.ts's Layer-2 REST verification defaulted to a stale
// http://localhost:5560 (pre-haven port scheme) independent of APP_BASE
// above — silently pointing every Layer-2 check at a dead port unless
// LW_BASE_URL was set by hand. Default it to APP_BASE so a bare
// `npx vitest run` against the local haven stack Just Works.
export const LW_BASE_URL = process.env.LW_BASE_URL ?? APP_BASE;
export const LANGWATCH_API_KEY =
  process.env.LANGWATCH_API_KEY ?? "sk-lw-local-development-key";
