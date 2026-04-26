import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

export async function startLangevals(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langevals" });
  const start = Date.now();

  const uvBin = ctx.predeps.uv?.resolvedPath;
  if (!uvBin) throw new Error("uv predep not resolved");

  const sp = servicePaths(ctx.paths);
  const venvDir = sp.venv("langevals");
  const projectDir = locateProject("langevals");
  if (!projectDir) throw new Error("langevals project dir not found");

  const handle = supervise({
    spec: {
      name: "langevals",
      command: uvBin,
      args: [
        "run",
        "--project", projectDir,
        "--no-sync",
        "python",
        join("langevals", "server.py"),
      ],
      env: {
        ...process.env,
        ...envFromFile,
        UV_PROJECT_ENVIRONMENT: venvDir,
        PORT: String(ctx.ports.langevals),
        DISABLE_EVALUATORS_PRELOAD: "true",
      },
      cwd: projectDir,
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.langevals}/`),
    timeoutMs: 60_000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`langevals did not become healthy: ${ready.reason}`);
  }
  bus.emit({ type: "healthy", service: "langevals", durationMs: Date.now() - start });
  return handle;
}

function locateProject(name: string): string | null {
  const dir = join(appRoot(), name);
  return existsSync(join(dir, "pyproject.toml")) ? dir : null;
}
