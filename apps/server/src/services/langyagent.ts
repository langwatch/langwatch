import { mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";

import { nowInstant } from "@langwatch/time";
import { execa } from "execa";

import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

// Check if mono-binary supports langyagent subcommand.
export async function monobinarySupportsLangyagent(binary: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execa(binary, [], {
      reject: false,
      timeout: 5_000,
    });
    return `${stdout}\n${stderr}`.includes("langyagent");
  } catch {
    return false;
  }
}

// The manager only accepts running workers without per-worker isolation in a
// local-like environment (services/langyagent/config.go enforces this on its
// side too). Mirroring the check here means a .env edited to a production-like
// ENVIRONMENT never even asks for the unsafe mode.
const UNSAFE_ISOLATION_ENVIRONMENTS = new Set(["local", "development", "dev", "test"]);

// Langy assistant manager. Runs unsandboxed on laptop (one person, one UID).
export async function startLangyagent(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langyagent" });
  const start = nowInstant().epochMilliseconds;

  const binary = ctx.predeps.aigateway?.resolvedPath;
  if (!binary) throw new Error("aigateway/langyagent monobinary predep not resolved");

  // Per-conversation homes and the shared workspace. The manager's defaults
  // point at the container image's /workspace, which does not exist here.
  const langyRoot = join(ctx.paths.root, "langyagent");
  const sessionsRoot = join(langyRoot, "sessions");
  const workspaceRoot = join(langyRoot, "workspace");
  mkdirSync(sessionsRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  const environment = (envFromFile.ENVIRONMENT ?? "local").trim().toLowerCase();
  const isLocalLike = UNSAFE_ISOLATION_ENVIRONMENTS.has(environment);

  const sp = servicePaths(ctx.paths);
  const handle = supervise({
    spec: {
      name: "langyagent",
      command: binary,
      args: ["langyagent"],
      env: {
        ...process.env,
        ...envFromFile,
        // The manager takes its listen port from PORT, not SERVER_ADDR.
        PORT: String(ctx.ports.langyagent),
        SESSIONS_ROOT: sessionsRoot,
        LANGY_WORKSPACE_ROOT: workspaceRoot,
        // Workers spawn as the user who ran the installer. Only asked for in
        // a local-like ENVIRONMENT (the scaffolded .env's default); the
        // manager refuses it anywhere else, and we do not ask.
        ...(isLocalLike ? { LANGY_UNSAFE_DEV_DISABLE_ISOLATION: "true" } : {}),
        // Each worker is an opencode process holding a real conversation; two
        // at a time is as much as a laptop should be asked to hold, and idle
        // ones are reaped quickly so a finished conversation stops costing
        // memory. Production's ceilings are much higher and set in the chart.
        LANGY_MAX_WORKERS: envFromFile.LANGY_MAX_WORKERS ?? "2",
        LANGY_WORKER_IDLE_MS: envFromFile.LANGY_WORKER_IDLE_MS ?? "120000",
        // opencode and the `langwatch` CLI both live in ~/.langwatch/bin; the
        // workers inherit exactly this PATH (the manager's allowlist passes it
        // through), which is how their tool calls resolve.
        PATH: [ctx.paths.bin, process.env.PATH ?? ""].filter(Boolean).join(delimiter),
        LOG_FORMAT: "pretty",
      },
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.langyagent}/health`),
    timeoutMs: 30_000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`langyagent did not become healthy: ${ready.reason}`);
  }
  bus.emit({
    type: "healthy",
    service: "langyagent",
    durationMs: nowInstant().epochMilliseconds - start,
  });
  return handle;
}
