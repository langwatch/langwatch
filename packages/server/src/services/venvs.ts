import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { RuntimeContext } from "../shared/runtime-contract.ts";
import { appRoot } from "./app-dir.ts";
import type { EventBus } from "./event-bus.ts";
import { servicePaths } from "./paths.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";
import { resolveEffectiveFeatures } from "../shared/features.ts";

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

// The extras every install gets (see services/langevals/pyproject.toml for the full
// set). `--extra all` is the union of these plus the three optional ones
// below; naming them individually is how we drop some without dropping the
// rest.
const LANGEVALS_BASE_EXTRAS = [
  "azure",
  "langevals",
  "openai",
  "ragas",
  "topic_clustering",
];

function resolveVenvSpecs(ctx: RuntimeContext): VenvSpec[] {
  const root = appRoot();
  // Three evaluator families are opt-in. Two for weight: the PII detector
  // brings a ~620MB spacy model and language detection ~95MB of language
  // models. The deprecated legacy evaluators are opt-in for a different
  // reason: they exist only so evaluations saved years ago keep running, and
  // deprecated things should vanish rather than nag (most of their heavy
  // dependencies are shared with the current ragas family anyway). The
  // product tells anyone who reaches for one of these how to get it. Nothing
  // about redaction depends on the PII toggle: LangWatch's own secret and
  // PII redaction in the ingestion pipeline is not implemented with presidio.
  const features = resolveEffectiveFeatures(ctx.envFile);
  const extras = [
    ...LANGEVALS_BASE_EXTRAS,
    ...(features.isLinguaEnabled ? ["lingua"] : []),
    ...(features.isLegacyEvaluatorsEnabled ? ["legacy"] : []),
    ...(features.isPresidioEnabled ? ["presidio"] : []),
  ];
  // langevals is the only Python venv we build — nlpgo runs from the
  // aigateway monobinary and needs no uv environment.
  const specs: VenvSpec[] = [
    {
      name: "langevals",
      projectDir: join(root, "services", "langevals"),
      lockFile: join(root, "services", "langevals", "uv.lock"),
      // langevals's evaluator routes (ROUGE Score, exact match, llm-as-judge,
      // etc.) live in subpackages declared as optional dependencies in
      // services/langevals/pyproject.toml: langevals-ragas, langevals-openai,
      // langevals-langevals, langevals-azure, langevals-lingua,
      // langevals-presidio, langevals-legacy. Each is a separate `langevals_*`
      // distribution; server.py auto-registers FastAPI routes for any
      // `langevals_*` package found via importlib.metadata.distributions().
      // Without any extras, only langevals + langevals-core get installed
      // and `/openapi.json` reports just `/healthcheck` and `/` — every
      // evaluator request 404s, langwatch app's runEvaluation throws
      // `404 {"detail":"Not Found"}`, and the experiments workbench column
      // shows 'Internal error' for every row. So the base set always
      // installs, and only the three opt-in members have to be asked for.
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
