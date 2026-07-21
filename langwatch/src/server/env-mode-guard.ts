/**
 * server.mts loads .env with `override: true` so pinned values beat whatever
 * start.sh exported — but NODE_ENV is a runtime MODE, not configuration. A
 * `NODE_ENV="development"` line in a dev machine's .env would silently
 * de-productionize `pnpm start` (API port moves to PORT+1000, no CSP, no
 * static serving) while the process composition stays prod. Restore the
 * process-level value after dotenv runs and say so once.
 *
 * @see specs/setup/memory-footprint.feature — "pnpm start stays in production
 * mode on a machine with a dev .env"
 */
export function keepProcessNodeEnv(
  valueBeforeDotenv: string | undefined,
  warn: (message: string) => void = (message) => console.warn(message),
): void {
  if (process.env.NODE_ENV === valueBeforeDotenv) return;
  warn(
    `[langwatch] ignoring NODE_ENV="${process.env.NODE_ENV}" from .env — ` +
      `keeping "${valueBeforeDotenv ?? "(unset)"}" from the environment. ` +
      `NODE_ENV is a runtime mode; remove it from .env.`,
  );
  if (valueBeforeDotenv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = valueBeforeDotenv;
  }
}
