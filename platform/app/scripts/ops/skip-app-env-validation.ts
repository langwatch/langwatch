// Imported first, for its side effect: the app's env schema validates on
// import and demands every server variable, while an ops script checks the
// few it actually uses itself (see src/env-load.ts for why a module).
process.env.SKIP_ENV_VALIDATION = "1";
