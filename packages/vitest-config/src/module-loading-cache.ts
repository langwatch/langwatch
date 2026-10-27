// The worker hooks in ./module-loading-cache/register.ts, by URL so it resolves from any cwd.
const REGISTER = new URL("./module-loading-cache/register.ts", import.meta.url).href;

/**
 * The `--import` that puts the module loading cache in every Vitest worker. On for local
 * runs, off in CI, where a fresh runner only pays to fill it. LANGWATCH_VITEST_MODULE_CACHE
 * set to `0` or `1` outranks both. Rationale: dev/docs/best_practices/testing-speed.md.
 */
export function moduleLoadingCacheExecArgv(): string[] {
  const setting = process.env.LANGWATCH_VITEST_MODULE_CACHE;
  const on = setting === undefined ? !process.env.CI : setting !== "0";
  return on ? ["--import", REGISTER] : [];
}
