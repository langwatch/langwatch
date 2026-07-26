import { scaffoldEnvFile } from "../shared/env.ts";
import type { RuntimeContext } from "../shared/runtime-contract.ts";

/**
 * `runtime.scaffoldEnv` thin wrapper. Idempotent — if `~/.langwatch/.env`
 * exists, user-owned values (OPENAI_API_KEY etc.) survive across runs and
 * only the port-bound URLs are reconciled to this run's allocation (the
 * ctx here always carries a real, conflict-checked port table).
 */
export function scaffoldEnv(ctx: RuntimeContext): {
	written: boolean;
	path: string;
	reconciledKeys: string[];
} {
	return scaffoldEnvFile({
		ports: ctx.ports,
		path: ctx.envFile,
		shouldReconcilePorts: true,
	});
}
