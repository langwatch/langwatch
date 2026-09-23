import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { nowInstant } from "@langwatch/time";

import { resolveEffectiveFeatures } from "../shared/features.ts";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { servicePaths } from "./paths.ts";

type VenvSpec = {
  name: "langevals";
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
  const specs = resolveVenvSpecs(ctx);

  await Promise.all(
    specs.map(async (spec) => {
      const venvDir = sp.venv(spec.name);
      const hashFile = join(venvDir, ".lock-hash");
      // Hash key includes the extras list so a venv installed without
      // --extra all (e.g. an upgrade from < beta.17) gets re-synced when
      // the spec adds new extras. Pure-lockfile hashing missed this and
      // left langevals with no evaluator routes registered.
      const expected = `${hashFileSafely(spec.lockFile)}|extras=${(spec.extras ?? []).slice().toSorted().join(",")}`;
      const isUpToDate = existsSync(venvDir) && readFileSafely(hashFile) === expected;
      if (isUpToDate) return;

      bus.emit({ type: "starting", service: `prepare:${spec.name}` as never });
      const start = nowInstant().epochMilliseconds;

      mkdirSync(venvDir, { recursive: true });
      const extraArgs = (spec.extras ?? []).flatMap((e) => ["--extra", e]);
      await execAndPipe({
        bus,
        service: `prepare:${spec.name}`,
        bin: uvBin,
        args: ["sync", "--project", spec.projectDir, ...extraArgs],
        options: {
          env: {
            ...process.env,
            UV_PROJECT_ENVIRONMENT: venvDir,
          },
        },
      });
      writeFileSync(hashFile, expected);
      bus.emit({
        type: "healthy",
        service: `prepare:${spec.name}` as never,
        durationMs: nowInstant().epochMilliseconds - start,
      });
    }),
  );
}

// The extras every install gets (see services/langevals/pyproject.toml for the full
// set). `--extra all` is the union of these plus the three optional ones
// below; naming them individually is how we drop some without dropping the
// rest.
const LANGEVALS_BASE_EXTRAS = ["azure", "langevals", "openai", "ragas", "topic_clustering"];

function resolveVenvSpecs(ctx: RuntimeContext): VenvSpec[] {
  const root = appRoot();
  // Two evaluator families are opt-in for weight: PII detection (~620MB
  // spacy) and language detection (~95MB). Unrelated to LangWatch's own
  // ingestion-pipeline PII redaction, which doesn't use presidio.
  const features = resolveEffectiveFeatures(ctx.envFile);
  const extras = [
    ...LANGEVALS_BASE_EXTRAS,
    ...(features.isLinguaEnabled ? ["lingua"] : []),
    ...(features.isPresidioEnabled ? ["presidio"] : []),
  ];
  // langevals is the only Python venv we build — nlpgo runs from the
  // aigateway monobinary and needs no uv environment.
  const specs: VenvSpec[] = [
    {
      name: "langevals",
      projectDir: join(root, "services", "langevals"),
      lockFile: join(root, "services", "langevals", "uv.lock"),
      // langevals subpackages are optional. Base set always installs.
      extras,
    },
  ];

  return specs;
}

function hashFileSafely(file: string): string {
  if (!existsSync(file)) return "missing";
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function readFileSafely(file: string): string | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").trim();
}
