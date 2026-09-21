/**
 * env-load.ts loads .env with `override: true` so pinned values beat whatever
 * start.sh exported — but NODE_ENV is a runtime MODE, not configuration. A
 * `NODE_ENV="development"` line in a dev machine's .env would silently
 * de-productionize `pnpm start` (API port moves to PORT+1000, no CSP, no
 * static serving) while the process composition stays prod. Restore the
 * process-level value after dotenv runs and say so once.
 *
 * @see specs/setup/memory-footprint.feature — "pnpm start stays in production
 * mode on a machine with a dev .env"
 */
export function keepProcessNodeEnv({
  valueBeforeDotenv,
  warn = (message) => console.warn(message),
}: {
  valueBeforeDotenv: string | undefined;
  warn?: (message: string) => void;
}): void {
  // An exported-but-empty NODE_ENV names no mode, so treat it as unset. Every
  // shell reader already does (`start.sh`'s `[ -z "$NODE_ENV" ]`,
  // `check-ports.sh`'s `${NODE_ENV:-production}`); without this the guard would
  // restore `""`, which env-create.mjs's required z.enum rejects — turning a
  // boot that used to succeed into an invalid-enum crash.
  const declaredMode = valueBeforeDotenv || undefined;

  if (process.env.NODE_ENV === declaredMode) return;

  // Nothing to protect. The process declared no mode of its own, so .env is the
  // only thing that named one, and there is no production boot here to
  // de-productionize. Deleting it would leave NODE_ENV unset — which
  // env-create.mjs rejects outright, since it validates NODE_ENV as a required
  // z.enum. The entrypoints that run without start.sh to default the variable
  // (`pnpm start:app`, `pnpm start:app:dev`) would then die with
  // "NODE_ENV: Required" rather than boot. A guard against silent
  // de-productionizing must not become the reason the process cannot start.
  if (declaredMode === undefined) return;

  warn(
    `[langwatch] ignoring NODE_ENV="${process.env.NODE_ENV}" from the .env ` +
      `files — keeping "${declaredMode}" from the environment. ` +
      `NODE_ENV is a runtime mode; remove it from .env / .env.portless.`,
  );
  process.env.NODE_ENV = declaredMode;
}
