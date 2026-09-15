import { scaffoldEnvFile } from "../shared/env.ts";
import type { RuntimeContext } from "../shared/runtime-contract.ts";

// Idempotent .env scaffolder. reconcilePorts defaults to true (start flow).
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
