import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { httpGetCheck, pollUntilHealthy } from "./health.ts";
import { servicePaths } from "./paths.ts";
import { supervise, type SupervisedHandle } from "./spawn.ts";

export async function startLangwatchNlp(
  ctx: RuntimeContext,
  bus: EventBus,
  envFromFile: Record<string, string>,
): Promise<SupervisedHandle> {
  bus.emit({ type: "starting", service: "langwatch_nlp" });
  const start = Date.now();

  const uvBin = ctx.predeps.uv?.resolvedPath;
  if (!uvBin) throw new Error("uv predep not resolved");

  const sp = servicePaths(ctx.paths);
  const venvDir = sp.venv("langwatch_nlp");
  const projectDir = locateProject("langwatch_nlp");
  if (!projectDir) throw new Error("langwatch_nlp project dir not found");

  const handle = supervise({
    spec: {
      name: "langwatch_nlp",
      command: uvBin,
      args: [
        "run",
        "--project", projectDir,
        "--no-sync",
        "uvicorn",
        "langwatch_nlp.main:app",
        "--host", "127.0.0.1",
        "--port", String(ctx.ports.nlp),
        "--timeout-keep-alive", "70",
      ],
      env: {
        ...process.env,
        ...envFromFile,
        UV_PROJECT_ENVIRONMENT: venvDir,
        PORT: String(ctx.ports.nlp),
      },
      cwd: projectDir,
    },
    paths: sp,
    bus,
  });

  const ready = await pollUntilHealthy({
    check: httpGetCheck(`http://127.0.0.1:${ctx.ports.nlp}/health`),
    timeoutMs: 60_000,
  });
  if (!ready.ok) {
    await handle.stop();
    throw new Error(`langwatch_nlp did not become healthy: ${ready.reason}`);
  }
  bus.emit({ type: "healthy", service: "langwatch_nlp", durationMs: Date.now() - start });
  return handle;
}

function locateProject(name: string): string | null {
  const dir = join(appRoot(), name);
  return existsSync(join(dir, "pyproject.toml")) ? dir : null;
}
