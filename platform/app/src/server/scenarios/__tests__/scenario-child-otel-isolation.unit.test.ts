/**
 * The telemetry boundary between the worker and a scenario child process.
 *
 * `buildChildProcessEnv` is an allow-list, and the allow-list IS the isolation:
 * everything a scenario's SDK reports — which endpoint it ships spans to, which
 * API key it authenticates with, what resource attributes they carry, whether
 * they hang off somebody else's trace — is decided by what does and does not
 * survive this function.
 *
 * Nothing pinned it before. That mattered less when dispatch was a
 * fire-and-forget reactor; under ADR-073 step 2 (retired; ground now
 * ADR-103) the spawn happens inside the
 * outbox's own CONSUMER span, on a worker that carries the platform's telemetry
 * configuration, with up to `SCENARIO_EXECUTION_CONCURRENCY` runs interleaved in
 * one process. Each of those is a way for one run's telemetry to become
 * another's, or the platform's.
 *
 * The runtime counterpart — real children, a real collector — is
 * `scenario.processor.otel-isolation.integration.test.ts`. These are the same
 * guarantees at the seam where they are actually decided, and they run in
 * milliseconds rather than ninety seconds.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeScenarioLogContext } from "../execution/child-logger";
import {
  buildChildProcessEnv,
  buildOtelResourceAttributes,
} from "../scenario.processor";

/** Telemetry the worker process itself carries, and must not pass on. */
const PARENT_TELEMETRY_ENV = {
  LANGWATCH_API_KEY: "parent-platform-key",
  LANGWATCH_ENDPOINT: "https://parent.example.com",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://parent-collector:4318",
  OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer parent-token",
  OTEL_SERVICE_NAME: "langwatch-service-worker",
  OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=production",
  OTEL_TRACES_EXPORTER: "otlp",
  TRACEPARENT: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  TRACESTATE: "langwatch=worker",
};

/** What one run is handed, resolved per run by the data prefetcher. */
function runTelemetry(overrides: Record<string, string | undefined> = {}) {
  return {
    LANGWATCH_API_KEY: "run-scoped-key",
    LANGWATCH_ENDPOINT: "https://tenant.example.com",
    SCENARIO_HEADLESS: "true",
    OTEL_RESOURCE_ATTRIBUTES: buildOtelResourceAttributes(["support"]),
    ...overrides,
  };
}

describe("scenario child process telemetry env", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, PARENT_TELEMETRY_ENV);
  });

  afterEach(() => {
    for (const key of Object.keys(PARENT_TELEMETRY_ENV)) {
      delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  describe("given the worker carries its own telemetry configuration", () => {
    it("gives the child the run's credentials, not the worker's", () => {
      const env = buildChildProcessEnv(runTelemetry());

      // A child that inherited the worker's key would report a customer's
      // scenario against the platform's own telemetry account.
      expect(env.LANGWATCH_API_KEY).toBe("run-scoped-key");
      expect(env.LANGWATCH_ENDPOINT).toBe("https://tenant.example.com");
    });

    it("does not pass the worker's OTLP exporter configuration through", () => {
      const env = buildChildProcessEnv(runTelemetry());

      // These decide where spans physically land. Inheriting them sends
      // customer scenario traces to the platform's collector.
      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
      expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined();
      expect(env.OTEL_TRACES_EXPORTER).toBeUndefined();
    });

    it("does not let the worker's service identity describe the run", () => {
      const env = buildChildProcessEnv(runTelemetry());

      expect(env.OTEL_SERVICE_NAME).toBeUndefined();
    });

    it("gives the child only the resource attributes built for the run", () => {
      const env = buildChildProcessEnv(runTelemetry());

      expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe(
        "langwatch.origin.source=platform,scenario.labels=support",
      );
      expect(env.OTEL_RESOURCE_ATTRIBUTES).not.toContain(
        "deployment.environment",
      );
    });

    /**
     * Since ADR-073 step 2 (retired; ground now ADR-103) the spawn happens
     * inside the outbox dispatcher's
     * CONSUMER span, whose parent is restored from the committing request's
     * W3C carrier. If that context reached the child, every scenario's spans
     * would hang off the dispatch that started them — and a redelivery would
     * graft a second run onto the same trace.
     */
    it("does not propagate the dispatching span's trace context into the child", () => {
      const env = buildChildProcessEnv(runTelemetry());

      expect(env.TRACEPARENT).toBeUndefined();
      expect(env.TRACESTATE).toBeUndefined();
    });

    it("passes through only the process-level variables a child needs to boot", () => {
      process.env.AWS_SECRET_ACCESS_KEY = "should-not-travel";
      process.env.DATABASE_URL = "postgres://should-not-travel";

      const env = buildChildProcessEnv(runTelemetry());

      try {
        expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
        expect(env.DATABASE_URL).toBeUndefined();
        // The child is a Node process that has to start at all.
        expect(env.PATH).toBe(process.env.PATH);
        expect(env.SKIP_ENV_VALIDATION).toBe("1");
      } finally {
        delete process.env.AWS_SECRET_ACCESS_KEY;
        delete process.env.DATABASE_URL;
      }
    });
  });

  describe("given a run supplies no value for a telemetry variable", () => {
    it("omits the key rather than handing the child the string 'undefined'", () => {
      const env = buildChildProcessEnv(
        runTelemetry({ LANGWATCH_API_KEY: undefined }),
      );

      // `LANGWATCH_API_KEY=undefined` is a *present* credential that fails
      // authentication, which reads as a broken tenant rather than an
      // unconfigured run — and it would silently shadow the absence.
      expect("LANGWATCH_API_KEY" in env).toBe(false);
    });

    it("does not fall back to the worker's value for it", () => {
      const env = buildChildProcessEnv(
        runTelemetry({ LANGWATCH_ENDPOINT: undefined }),
      );

      expect(env.LANGWATCH_ENDPOINT).toBeUndefined();
    });
  });

  describe("when several runs are dispatched concurrently on one worker", () => {
    /**
     * The outbox leases up to `SCENARIO_EXECUTION_CONCURRENCY` messages and
     * dispatches them through a bounded pool in a single process, so these
     * calls genuinely interleave. The reactor never did that — it handed jobs
     * to a pool that started them one at a time from its own array.
     */
    it("keeps each run's telemetry to itself", () => {
      const first = buildChildProcessEnv({
        LANGWATCH_API_KEY: "key-tenant-a",
        LANGWATCH_ENDPOINT: "https://a.example.com",
        OTEL_RESOURCE_ATTRIBUTES: buildOtelResourceAttributes(["tenant-a"]),
      });
      const second = buildChildProcessEnv({
        LANGWATCH_API_KEY: "key-tenant-b",
        LANGWATCH_ENDPOINT: "https://b.example.com",
        OTEL_RESOURCE_ATTRIBUTES: buildOtelResourceAttributes(["tenant-b"]),
      });

      expect(first.LANGWATCH_API_KEY).toBe("key-tenant-a");
      expect(second.LANGWATCH_API_KEY).toBe("key-tenant-b");
      expect(first.OTEL_RESOURCE_ATTRIBUTES).toContain("tenant-a");
      expect(second.OTEL_RESOURCE_ATTRIBUTES).toContain("tenant-b");
    });

    it("hands back independent objects, so one run cannot rewrite another's", () => {
      const first = buildChildProcessEnv(runTelemetry());
      const second = buildChildProcessEnv(runTelemetry());

      first.LANGWATCH_API_KEY = "mutated";

      // A shared or memoised env object is the kind of optimisation that looks
      // free and quietly cross-wires two tenants' spans.
      expect(second.LANGWATCH_API_KEY).toBe("run-scoped-key");
      expect(first).not.toBe(second);
    });
  });

  describe("given the run's log context travels beside its telemetry", () => {
    it("carries this run's identities and no other's", () => {
      const env = buildChildProcessEnv({
        ...runTelemetry(),
        LANGWATCH_LOG_CONTEXT: encodeScenarioLogContext({
          scenarioRunId: "run-1",
          batchRunId: "batch-1",
          projectId: "project-1",
          scenarioId: "scenario-1",
          setId: "set-1",
        }),
      });

      expect(JSON.parse(env.LANGWATCH_LOG_CONTEXT!)).toEqual({
        scenarioRunId: "run-1",
        batchRunId: "batch-1",
        projectId: "project-1",
        scenarioId: "scenario-1",
        setId: "set-1",
      });
    });
  });
});
