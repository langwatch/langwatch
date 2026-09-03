import { createRequire } from "node:module";

// Continuous profiling for the Node process, pushed to Pyroscope.
//
// Two profilers run, both started by Pyroscope.start(): the wall-time profiler
// (carrying CPU time too — see the init call below) and the heap profiler. Heap
// samples flush on a slower cadence than wall ones, so a short-lived process may
// push wall profiles and never get as far as a heap one; that is the SDK's
// cadence, not a missing configuration.
//
// Dependency-free at module scope by design — this is imported from
// instrumentation.node.ts, which runs before the app graph exists. The profiler
// and its native pprof bindings load inside startProfiling(), and only when an
// endpoint is configured, so a self-hosted install that has never heard of
// Pyroscope does not pay for it at boot.
//
// The gating is the same bargain the OTLP exporters strike a few lines up in
// that file: a profiler with nowhere to push to still samples on a timer and
// still fails every upload, so "off" has to mean off, not "on and failing".

/**
 * Pyroscope label names follow the Prometheus grammar, which rejects the dot in
 * an OpenTelemetry attribute name. A key copied across verbatim does not error —
 * the push succeeds and the label is simply absent when someone goes looking for
 * it — so the substitution has to happen here.
 *
 * Underscore matches what Loki's structured metadata already does to the same
 * attribute (langwatch_worktree), so one spelling works across the signals.
 */
export const normaliseTagKey = (key: string): string =>
  key
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^[0-9]/, "_");

/**
 * Reads OTEL_RESOURCE_ATTRIBUTES so a profile carries the identity the traces,
 * logs and metrics from this process already carry. In local development that is
 * langwatch.worktree, which is what lets a developer filter a flame graph down
 * to their own worktree while a dozen share one Pyroscope.
 */
export const tagsFromResourceAttributes = (
  raw: string | undefined,
): Record<string, string> => {
  const tags: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const key = normaliseTagKey(pair.slice(0, separator));
    const value = pair.slice(separator + 1).trim();
    if (key && value) tags[key] = value;
  }
  return tags;
};

// Type-only, so it is erased at compile time and the module never reaches the
// boot graph — which is the whole point of the lazy require below. Top-level
// rather than an inline `typeof import(...)` per the repo's ban on inline
// import() (CLAUDE.md).
import type * as PyroscopeNodejs from "@pyroscope/nodejs";

type PyroscopeModule = typeof PyroscopeNodejs;

/**
 * The one CommonJS resolver this module keeps, so the profiler's native
 * binding is loaded on demand rather than at import.
 */
const moduleRequire = createRequire(import.meta.url);

export interface ProfilingOptions {
  serverAddress: string | undefined;
  appName: string;
  environment: string | undefined;
  resourceAttributes: string | undefined;
  /**
   * How the profiler module is loaded. Injected only by tests.
   *
   * The failure path below — "the native binding is unavailable on this
   * platform" — is the one branch that cannot be reached by passing different
   * options, and mocking a module that a *already-imported* module `require`s
   * depends on the test runner's interception timing. A test that quietly stops
   * exercising the branch it names still passes, which is the worst kind of
   * green. A seam makes it deterministic.
   */
  loadProfiler?: () => PyroscopeModule;
}

export interface StartedProfiler {
  stop: () => Promise<void>;
}

/**
 * Starts continuous profiling, or does nothing when no endpoint is configured.
 *
 * Never throws. A process that cannot profile itself has one fewer debugging
 * signal; a process that refuses to boot because it could not profile itself is
 * an outage.
 */
export const startProfiling = ({
  serverAddress,
  appName,
  environment,
  resourceAttributes,
  // Loaded through a CommonJS require rather than a static import, and the
  // reason is the gate itself: @pyroscope/nodejs and its native @datadog/pprof
  // binding must never enter the boot graph of a process that is not
  // profiling. `createRequire` is what gives an ES module that same deferral
  // without an inline `import()`, which this repository bans.
  loadProfiler = () => moduleRequire("@pyroscope/nodejs") as PyroscopeModule,
}: ProfilingOptions): StartedProfiler | undefined => {
  const address = serverAddress?.trim();
  if (!address) return undefined;

  const tags = tagsFromResourceAttributes(resourceAttributes);
  if (environment) tags.environment = environment;

  try {
    const Pyroscope = loadProfiler();

    Pyroscope.init({
      serverAddress: address,
      appName,
      tags,
      // The Node profiler samples WALL time, where the Go one samples CPU — a
      // difference that matters when reading the two side by side, and one
      // worth keeping rather than papering over. This server spends most of its
      // life waiting on Postgres, ClickHouse and model providers, and wall time
      // is the only signal that shows that waiting at all; a pure CPU profile of
      // a request that took four seconds and burned forty milliseconds is
      // technically accurate and answers the wrong question.
      //
      // collectCpuTime adds the CPU dimension to the same samples, so one push
      // answers both "where did the time go" and "where did the CPU go" without
      // running a second profiler.
      wall: { collectCpuTime: true },
    });
    Pyroscope.start();

    console.log(
      `[profiling] continuous profiling started — pushing ${appName} profiles to ${address}`,
    );

    return {
      stop: async () => {
        await Pyroscope.stop();
      },
    };
  } catch (error) {
    // Silence here is the failure mode this whole module exists to avoid: a
    // developer looking at an empty flame graph has no way to tell "never
    // started" from "started and uploading nowhere".
    console.warn(
      "[profiling] could not start continuous profiling — the server runs without it",
      error,
    );
    return undefined;
  }
};
