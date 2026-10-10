import { nowInstant } from "@langwatch/time";
import { execa } from "execa";

import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { startAigateway } from "./aigateway.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { startNlpgo } from "./nlpgo.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/** Whether the monobinary offers `command`: run bare, it prints the subcommands it has. */
export async function monobinaryOffers({
  binary,
  command,
}: {
  binary: string;
  command: string;
}): Promise<boolean> {
  try {
    const { stdout, stderr } = await execa(binary, [], { reject: false, timeout: 5_000 });
    return `${stdout}\n${stderr}`.includes(command);
  } catch {
    return false;
  }
}

/**
 * nlpgo and the ai-gateway as one `service combined` process, as the dev stack runs them
 * (ADR-004). A release binary from before combined mode gets the two spawns it always had.
 */
export async function startGoServices(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle[]> {
  const binary = ctx.predeps.aigateway?.resolvedPath;
  if (!binary) throw new Error("aigateway/nlpgo monobinary predep not resolved");
  if (await monobinaryOffers({ binary, command: "combined" })) {
    return [await startCombined({ ctx, bus, binary, envFromFile })];
  }
  const results = await Promise.allSettled([
    startNlpgo(ctx, bus, envFromFile),
    startAigateway(ctx, bus, envFromFile),
  ]);
  const started = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) {
    await Promise.allSettled(started.map((handle) => handle.stop()));
    throw failure.reason;
  }
  return started;
}

async function startCombined({
  ctx,
  bus,
  binary,
  envFromFile,
}: {
  ctx: RuntimeContext;
  bus: EventBus;
  binary: string;
  envFromFile: Record<string, string>;
}): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "go" });
  const start = nowInstant().epochMilliseconds;
  const app = `http://127.0.0.1:${ctx.ports.langwatch}`;
  const handle = supervise({
    spec: {
      name: "go",
      command: binary,
      args: ["combined", "nlpgo", "aigateway"],
      env: {
        ...process.env,
        ...envFromFile,
        // One process, two listeners: each service reads its own address (cmd/service/combined.go).
        LANGWATCH_GO_NLPGO_ADDR: `:${ctx.ports.nlp}`,
        LANGWATCH_GO_AIGATEWAY_ADDR: `:${ctx.ports.aigateway}`,
        // What startNlpgo and startAigateway each point back at the app.
        NLPGO_ENGINE_LANGWATCH_BASE_URL: app,
        LANGWATCH_ENDPOINT: app,
        LW_GATEWAY_BASE_URL: app,
        LOG_FORMAT: "pretty",
      },
    },
    paths: servicePaths(ctx.paths),
    bus,
  });

  const probes = await Promise.all(
    [ctx.ports.nlp, ctx.ports.aigateway].map((port) =>
      pollUntilHealthy({
        check: httpGetCheck(`http://127.0.0.1:${port}/healthz`),
        timeoutMs: 30_000,
      }),
    ),
  );
  const unhealthy = probes.find((probe) => !probe.ok);
  if (unhealthy && !unhealthy.ok) {
    await handle.stop();
    throw new Error(`nlpgo and aigateway did not become healthy: ${unhealthy.reason}`);
  }
  bus.emit({
    type: "healthy",
    service: "go",
    durationMs: nowInstant().epochMilliseconds - start,
  });
  return handle;
}
