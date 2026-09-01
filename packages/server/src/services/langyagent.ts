import { execa } from "execa";
import { mkdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

/**
 * Whether the downloaded mono-binary knows the `langyagent` subcommand.
 * Binaries released before the assistant existed answer any unknown command
 * with a usage line listing the services they do have, so the presence of
 * the name in that output is the honest capability check. Without this
 * probe, an older binary dies at boot with "unknown service" and takes the
 * whole install down with it; with it, the install comes up assistant-less
 * and says why.
 *
 * Never throws and never hangs: the assistant is optional, so a probe that
 * cannot answer (broken binary, hung exec) reads as "not supported" and the
 * install proceeds without the assistant rather than dying over it.
 */
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

// Which environments this installer will ask for shared-identity workers in.
// The manager no longer refuses the posture outside a local-like ENVIRONMENT —
// ADR-130 made it an operator's choice, acknowledged in a values file — so this
// set is now the only thing standing between a .env edited to a production-like
// ENVIRONMENT and a silently weaker install. It selects a posture rather than
// mirroring a refusal, which is why it stays.
const UNSAFE_ISOLATION_ENVIRONMENTS = new Set(["local", "development", "dev", "test"]);

/**
 * The Langy assistant's manager, the process that owns one worker per
 * conversation. Same `cmd/service` mono-binary as the gateway and the NLP
 * engine, dispatched as `langyagent`, so the assistant adds no download of its
 * own.
 *
 * Health: /health.
 *
 * WHAT IS DIFFERENT ABOUT A LAPTOP. In a cluster this pod runs under a
 * sandboxed container runtime, as root, handing every conversation's worker
 * its own UID, because there the workers belong to different people and a
 * prompt-injected one must not be able to read a colleague's live credentials
 * out of /proc. Here there is one person, on their own machine, and each worker
 * already runs as them with their own credentials. The UID handoff would need
 * root to perform, so demanding it would mean asking someone to run their
 * laptop install as root in order to isolate them from themselves. We run
 * unsandboxed instead, and say so rather than implying a boundary that is not
 * there.
 */
export async function startLangyagent(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langyagent" });
  const start = Date.now();

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
        // Workers spawn as the user who ran the installer, sharing one
        // identity. A laptop install is single-tenant by construction, and the
        // per-uid posture needs root plus five capabilities it does not have.
        // Only asked for in a local-like ENVIRONMENT; elsewhere we leave the
        // variable unset and the manager defaults to per-uid (ADR-130).
        ...(isLocalLike ? { LANGY_WORKER_ISOLATION: "none" } : {}),
        // Each worker is a process holding a real conversation; two at a time
        // is as much as a laptop should be asked to hold, and idle ones are
        // reaped quickly so a finished conversation stops costing memory.
        // Production's ceilings are much higher and set in the chart.
        LANGY_MAX_WORKERS: envFromFile.LANGY_MAX_WORKERS ?? "2",
        LANGY_WORKER_IDLE_MS: envFromFile.LANGY_WORKER_IDLE_MS ?? "120000",
        // The worker binary and the `langwatch` CLI both live in ~/.langwatch/bin; the
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
  bus.emit({ type: "healthy", service: "langyagent", durationMs: Date.now() - start });
  return handle;
}
