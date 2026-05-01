import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { scaffoldEnvFile } from "../shared/env.ts";

/**
 * `runtime.scaffoldEnv` thin wrapper. Idempotent — if `~/.langwatch/.env`
 * exists we leave it alone so the user's saved OPENAI_API_KEY/etc. survive
 * across runs. The CLI's `[2/4] env` phase calls this; the runtime calls
 * it again before `installServices` as a safety net.
 */
export function scaffoldEnv(ctx: RuntimeContext): { written: boolean; path: string } {
  return scaffoldEnvFile({ ports: ctx.ports, path: ctx.envFile });
}
