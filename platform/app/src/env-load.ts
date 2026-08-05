/**
 * Loads `.env` and then the `.env.portless` overlay (haven), in that order, as
 * a module side effect. Every entrypoint (server.mts, workers.ts, task.ts)
 * imports this module FIRST, before any module that reads process.env at load
 * time — instrumentation, and the app graph, which constructs the Redis and
 * Prisma singletons on import.
 *
 * It must be a module rather than inline statements in the entrypoint: static
 * imports hoist above the entry's own statements, so an inline
 * `dotenv.config()` runs AFTER every imported module has already evaluated.
 * workers.ts shipped exactly that bug — its overlay load sat below
 * `import "./instrumentation.node"` and `import { startWorkers } ...`, so the
 * standalone worker resolved Redis before `.env.portless` applied and
 * dispatched on db 0 while the server it served enqueued on haven's db 8.
 *
 * `override: true` lets `.env` win over values that scripts/start.sh exported
 * before the entry runs — start.sh defaults LW_GATEWAY_BASE_URL,
 * LW_GATEWAY_PUBLIC_URL, LANGWATCH_API_URL etc. from $PORT when those vars are
 * unset in the shell, and without override those exports silently mask the
 * .env value. NODE_ENV / PORT / similar process-level vars stay shell-only
 * because .env shouldn't carry them. The portless overlay loads LAST with
 * override so the haven-resolved hostname URLs and ports win over anything
 * pinned in .env; when the file is absent this is a no-op. See
 * tools/thuishaven.
 *
 * dotenv's "injected env (N) from .env" line stays LOUD in local dev — it's
 * the one confirmation of which env files actually loaded (it prints before
 * any logger exists; dotenv has no logger hook, only quiet). Prod and tests
 * silence it: there it's a stray non-JSON stdout line on every boot.
 */
import dotenv from "dotenv";
import { existsSync } from "fs";

const quiet = process.env.NODE_ENV !== "development";
dotenv.config({ override: true, quiet });
dotenv.config({
  path: ".env.portless",
  override: true,
  quiet: quiet || !existsSync(".env.portless"),
});
