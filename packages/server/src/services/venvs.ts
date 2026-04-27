import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { servicePaths } from "./paths.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";

type VenvSpec = {
  name: "langwatch_nlp" | "langevals";
  projectDir: string;
  lockFile: string;
  extras?: string[];
};

/**
 * Idempotent. For each python service: if the lockfile hash matches what we
 * recorded last sync, skip; otherwise run `uv sync --project <dir>` with
 * UV_PROJECT_ENVIRONMENT pointing at our managed venv path.
 */
export async function syncVenvs(ctx: RuntimeContext, bus: EventBus): Promise<void> {
  const uvBin = ctx.predeps.uv?.resolvedPath;
  if (!uvBin) throw new Error("uv predep not resolved — run install first");

  const sp = servicePaths(ctx.paths);
  const specs = resolveVenvSpecs();

  await Promise.all(
    specs.map(async (spec) => {
      const venvDir = sp.venv(spec.name);
      const hashFile = join(venvDir, ".lock-hash");
      // Hash key includes the extras list so a venv installed without
      // --extra all (e.g. an upgrade from < beta.17) gets re-synced when
      // the spec adds new extras. Pure-lockfile hashing missed this and
      // left langevals with no evaluator routes registered.
      const expected = `${hashFileSafely(spec.lockFile)}|extras=${(spec.extras ?? []).slice().sort().join(",")}`;
      if (existsSync(venvDir) && readFileSafely(hashFile) === expected) return;

      bus.emit({ type: "starting", service: `prepare:${spec.name}` as never });
      const start = Date.now();

      mkdirSync(venvDir, { recursive: true });
      const extraArgs = (spec.extras ?? []).flatMap((e) => ["--extra", e]);
      await execAndPipe(
        bus,
        `prepare:${spec.name}`,
        uvBin,
        ["sync", "--project", spec.projectDir, ...extraArgs],
        {
          env: {
            ...process.env,
            UV_PROJECT_ENVIRONMENT: venvDir,
          },
        },
      );
      writeFileSync(hashFile, expected);
      bus.emit({ type: "healthy", service: `prepare:${spec.name}` as never, durationMs: Date.now() - start });
    }),
  );
}

function resolveVenvSpecs(): VenvSpec[] {
  const root = appRoot();
  return [
    {
      name: "langwatch_nlp",
      projectDir: join(root, "langwatch_nlp"),
      lockFile: join(root, "langwatch_nlp", "uv.lock"),
    },
    {
      name: "langevals",
      projectDir: join(root, "langevals"),
      lockFile: join(root, "langevals", "uv.lock"),
      // langevals's evaluator routes (ROUGE Score, exact match, llm-as-judge,
      // etc.) live in subpackages declared as optional dependencies in
      // langevals/pyproject.toml: langevals-ragas, langevals-openai,
      // langevals-langevals, langevals-azure, langevals-lingua,
      // langevals-presidio, langevals-legacy. Each is a separate `langevals_*`
      // distribution; server.py auto-registers FastAPI routes for any
      // `langevals_*` package found via importlib.metadata.distributions().
      // Without --extra all, only langevals + langevals-core get installed
      // and `/openapi.json` reports just `/healthcheck` and `/` — every
      // evaluator request 404s, langwatch app's runEvaluation throws
      // `404 {"detail":"Not Found"}`, and the experiments workbench column
      // shows 'Internal error' for every row. We install all extras so the
      // evaluator dispatch from langwatch_nlp + the legacy-eval REST route
      // can reach a real evaluator implementation.
      extras: ["all"],
    },
  ];
}

function hashFileSafely(file: string): string {
  if (!existsSync(file)) return "missing";
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readFileSafely(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim();
}
