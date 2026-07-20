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
