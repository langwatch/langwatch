import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";
import { nowInstant } from "@langwatch/time";

/**
 * The Go-native NLP service (services/nlpgo) — the only NLP engine. Reuses
 * the same in-binary mono-binary we already download for aigateway, just
 * dispatched as `nlpgo`.
 *
 * Health: /healthz (chi-routed liveness in services/nlpgo/adapters/httpapi).
 */
export async function startNlpgo(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "nlpgo" as never });
  const start = nowInstant().epochMilliseconds;

  // Reuse the aigateway predep's mono-binary — same `cmd/service` build,
  // dispatched here as `nlpgo` instead of `aigateway`. Saves us shipping
  // a separate GH release artifact + a separate predep.
  const binary = ctx.predeps.aigateway?.resolvedPath;
  if (!binary) throw new Error("aigateway/nlpgo monobinary predep not resolved");

  const sp = servicePaths(ctx.paths);
  const handle = supervise({
    spec: {
      name: "nlpgo",
      command: binary,
      args: ["nlpgo"],
      env: {
        ...process.env,
        ...envFromFile,
        SERVER_ADDR: `:${ctx.ports.nlp}`,
        // Engine pointer back to the langwatch app for evaluator +
        // agent-workflow callbacks. /api/* routes terminate inside the
        // langwatch process.
        NLPGO_ENGINE_LANGWATCH_BASE_URL: `http://127.0.0.1:${ctx.ports.langwatch}`,
        // OTel exporter target. Set explicitly for .env backward compat.
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${ctx.ports.langwatch}`,
        LOG_FORMAT: "pretty",
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.nlp}/healthz`),
    timeoutMs: 30_000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`nlpgo did not become healthy: ${ready.reason}`);
  }
  bus.emit({
    type: "healthy",
    service: "nlpgo" as never,
    durationMs: nowInstant().epochMilliseconds - start,
  });
  return handle;
}
