import { Counter, type Registry } from "prom-client";
import type { AuthzCutoverCounter } from "./observability.authz-cutover.adapter";
import type { AuthzRevocationCounter } from "./observability.authz-revocation.adapter";
import type { AuthzRevocationReason } from "../ports/authz-revocation-telemetry.port";

/**
 * The two series AuthZ emits, described once.
 *
 * A metric name is an external interface: alerts, dashboards and runbooks key
 * on it, and a second process emitting the same series under a different help
 * string — or, worse, a different name — splits one operational question into
 * two. Both processes that compose AuthZ take their counters from here, so
 * there is one description of what is counted and one of why.
 */
const DIRECT_PROJECTION_WRITE = {
  name: "langwatch_authz_direct_projection_write_total",
  help: "Authorization projection writes that bypassed the group queue, by cause",
} as const;

const ENGINE_GATE_READ_FAILURES = {
  name: "authz_engine_gate_read_failures_total",
  help: "Failed reads of an organization's AuthZ migration state; the organization stays on the legacy path for the cache TTL.",
} as const;

/**
 * Resolves AuthZ's counters against a process's own Prometheus registry.
 *
 * The registry arrives as an argument and is never reached for, so a test can
 * drive this against a private one — and so the composing process keeps the
 * decision the registry represents. What lives here is only WHICH series exist
 * and what they mean.
 *
 * Counters are resolved rather than constructed: a registry refuses a metric it
 * already holds, and a process that composes AuthZ twice (a test harness, a
 * host with two graphs) would otherwise fail at the second composition instead
 * of sharing the series it already has.
 */
export class ObservabilityAuthzMetricsAdapter {
  static create(options: { registry: Registry }): ObservabilityAuthzMetricsAdapter {
    return new ObservabilityAuthzMetricsAdapter(options.registry);
  }

  private constructor(private readonly registry: Registry) {}

  /** Labelled by cause, so one series answers "which kind of direct write". */
  revocationCounter(reason: AuthzRevocationReason): AuthzRevocationCounter {
    return this.resolve(DIRECT_PROJECTION_WRITE, ["reason"]).labels(reason);
  }

  engineGateReadFailureCounter(): AuthzCutoverCounter {
    return this.resolve(ENGINE_GATE_READ_FAILURES, []);
  }

  private resolve(
    metric: { name: string; help: string },
    labelNames: readonly string[],
  ): Counter<string> {
    const existing = this.registry.getSingleMetric(metric.name);
    if (existing instanceof Counter) return existing;
    return new Counter({
      name: metric.name,
      help: metric.help,
      labelNames: [...labelNames],
      registers: [this.registry],
    });
  }
}
