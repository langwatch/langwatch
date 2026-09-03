import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

export async function startAigateway(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "aigateway" });
  const start = Date.now();

  const binary = ctx.predeps.aigateway?.resolvedPath;
  if (!binary) throw new Error("aigateway predep not resolved");

  const sp = servicePaths(ctx.paths);
  const handle = supervise({
    spec: {
      name: "aigateway",
      command: binary,
      args: ["aigateway"],
      env: {
        ...process.env,
        ...envFromFile,
        // The Go gateway reads SERVER_ADDR for its listen address (see
        // services/aigateway/README.md and pkg/config/validate_test.go).
        // PORT alone is ignored — that's a Node convention, not Go.
        SERVER_ADDR: `:${ctx.ports.aigateway}`,
        LW_GATEWAY_BASE_URL: `http://127.0.0.1:${ctx.ports.langwatch}`,
        LOG_FORMAT: "pretty",
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.aigateway}/healthz`),
    timeoutMs: 30_000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`aigateway did not become healthy: ${ready.reason}`);
  }
  bus.emit({ type: "healthy", service: "aigateway", durationMs: Date.now() - start });
  return handle;
}
