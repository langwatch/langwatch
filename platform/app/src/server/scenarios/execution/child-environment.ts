/**
 * The environment a scenario child process is started with.
 *
 * This is the parent half of the parent/child contract, and it lives on its
 * own because it now has more than one caller: the child may be started as
 * soon as its inputs are known — alongside the rest of the prefetch — or on
 * the ordinary path once the prefetch has finished. Both must produce the
 * same environment, so neither builds it itself.
 *
 * Everything here is derivable from the job data, the parent's own process
 * env, and the two prefetched values in `ChildEnvInputs`. Nothing else is
 * needed to start a child, which is what makes starting one early possible.
 *
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

import os from "os";
import path from "path";
import { env } from "~/env.mjs";
import {
  encodeScenarioLogContext,
  SCENARIO_LOG_CONTEXT_ENV,
} from "./child-logger";
import { resolveChildTlsEnv } from "./child-tls-env";
import type { ChildEnvInputs } from "./data-prefetcher";
import type { ExecutionJobData } from "./execution-pool";

/**
 * Resource attributes for the child's tracer provider.
 *
 * These are resource — not span — attributes, so they are fixed when the
 * provider is created at the child's module load. That is why they have to be
 * known before the child starts rather than sent to it afterwards.
 *
 * @internal Exported for testing
 */
export function buildOtelResourceAttributes(labels: string[]): string {
  const parts = ["langwatch.origin.source=platform"];
  if (labels.length) {
    const escapedLabels = labels.map((l) =>
      l.replace(/\\/g, "\\\\").replace(/[,=]/g, "\\$&"),
    );
    parts.push(`scenario.labels=${escapedLabels.join(",")}`);
  }
  return parts.join(",");
}

/**
 * Where the child keeps its V8 compile cache. Under the OS temp dir because
 * that is writable in every deployment shape we ship, including a read-only
 * application root.
 *
 * Shared across runs on purpose, and safe to share: Node stores compiled
 * bytecode for the child's own source files, keyed by a hash of that source.
 * Nothing from a run — no job data, no conversation, no project — reaches it,
 * and every run compiles the identical bundle.
 */
const SCENARIO_CHILD_COMPILE_CACHE_DIR = path.join(
  os.tmpdir(),
  "langwatch-scenario-compile-cache",
);

/**
 * Filters out variables with no value, so the child inherits only real
 * bindings rather than a set of `undefined`s.
 *
 * @internal Exported for testing
 */
export function buildChildProcessEnv(
  scenarioVars: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const vars: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    NODE_ENV: process.env.NODE_ENV,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    SKIP_ENV_VALIDATION: "1",
    // The child is a fresh process per run, so without this it re-compiles the
    // same bundle every time. Node keys each entry by a hash of the source, so
    // a rebuilt bundle can never be served a stale compilation — the entries
    // for the old one are simply never read again. An unwritable directory
    // degrades to no caching rather than failing the spawn.
    NODE_COMPILE_CACHE:
      process.env.NODE_COMPILE_CACHE ?? SCENARIO_CHILD_COMPILE_CACHE_DIR,
    COREPACK_ENABLE_DOWNLOAD_PROMPT:
      process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT,
    // The platform's ceiling on how long a turn may hold a socket open, read
    // by the code agent adapter INSIDE the child (`resolveMaxFetchTimeoutMs`).
    // Forwarded raw: this allowlist is the only route from the operator's
    // environment into the child, and the child runs under
    // SKIP_ENV_VALIDATION, so `~/env.mjs` would apply no default here.
    NLP_FETCH_MAX_TIMEOUT_MS: process.env.NLP_FETCH_MAX_TIMEOUT_MS,
    ...scenarioVars,
  };

  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv;
}

/**
 * The complete environment for one child process.
 *
 * Call this from every place that starts a child. It is the single definition
 * of what a child is started with, so an early start and an ordinary one
 * cannot drift apart.
 */
export function buildChildEnvironment({
  jobData,
  labels,
  telemetry,
}: {
  jobData: ExecutionJobData;
  labels: string[];
  telemetry: ChildEnvInputs["telemetry"];
}): NodeJS.ProcessEnv {
  // TLS for the runner's own fetch stack (EventReporter → platform, and the
  // model API call). Forwards haven's trusted local CA when present; only in
  // local non-SaaS dev does it fall back to relaxing TLS. Never in SaaS/prod.
  const tlsEnv = resolveChildTlsEnv({
    isSaaS: !!env.IS_SAAS,
    nodeEnv: process.env.NODE_ENV,
    nodeExtraCaCerts: process.env.NODE_EXTRA_CA_CERTS,
  });

  return buildChildProcessEnv({
    LANGWATCH_API_KEY: telemetry.apiKey,
    LANGWATCH_ENDPOINT: telemetry.endpoint,
    SCENARIO_HEADLESS: "true",
    OTEL_RESOURCE_ATTRIBUTES: buildOtelResourceAttributes(labels),
    [SCENARIO_LOG_CONTEXT_ENV]: encodeScenarioLogContext({
      scenarioRunId: jobData.scenarioRunId,
      batchRunId: jobData.batchRunId,
      projectId: jobData.projectId,
      scenarioId: jobData.scenarioId,
      setId: jobData.setId,
    }),
    ...tlsEnv,
  });
}
