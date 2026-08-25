import { scaffoldEnvFile } from "../shared/env.ts";
import type { RuntimeContext } from "../shared/runtime-contract.ts";

/**
 * `runtime.scaffoldEnv` thin wrapper. Idempotent: if `~/.langwatch/.env`
 * exists, user-owned values (OPENAI_API_KEY etc.) survive across runs and
 * only the port-bound URLs are reconciled to this run's allocation (the
 * ctx here always carries a real, conflict-checked port table).
 *
 * `shouldReconcilePorts` defaults to true (the "start" flow's need) but the
 * "install" flow, which writes .env before any port conflict has been
 * resolved for this run, passes false so it does not rewrite URLs to a
 * guess that the actual start-up might not honor.
 */
export function scaffoldEnv(
  ctx: RuntimeContext,
  { shouldReconcilePorts = true }: { shouldReconcilePorts?: boolean } = {},
): {
  written: boolean;
  path: string;
  reconciledKeys: string[];
} {
  return scaffoldEnvFile({
    ports: ctx.ports,
    path: ctx.envFile,
    shouldReconcilePorts,
  });
}
