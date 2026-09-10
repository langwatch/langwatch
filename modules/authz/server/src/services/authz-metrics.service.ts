import { Counter, type Registry } from "prom-client";
import type { AuthzRevocationReason } from "./authz-revocation-telemetry.service.ts";

/** The one thing AuthZ asks of a metric: that it can be incremented. */
export type AuthzCounter = { inc(): void };

/**
 * Where AuthZ's two counters come from.
 *
 * It is an interface rather than a `Registry` argument because the registry
 * was the only reason composing this feature required a metrics library at
 * all. The two series are real and an operator reads both — a revocation
 * that bypassed the group queue, and a failed read of an organization's
 * migration state — but neither is a PRECONDITION of authorizing anything. A
 * background process that renders no scrape endpoint could not compose
 * `PostgresAuthzAdapter` while the counters arrived as `prom-client` objects,
 * which is a Prometheus decision reaching into who may hold an
 * `AuthzService`.
 *
 * This interface inverts that. A process that renders metrics implements it
 * over its own registry (`ObservabilityAuthzMetricsAdapter`); a process that
 * does not passes nothing and gets {@link UncountedAuthzMetrics}. What stays
 * in the feature either way is WHEN each counter moves, which is the part
 * that must not be described twice.
 */
export abstract class AuthzMetrics {
  /** Labelled by cause, so one series answers "which kind of direct write". */
  abstract revocationCounter(reason: AuthzRevocationReason): AuthzCounter;

  abstract engineGateReadFailureCounter(): AuthzCounter;
}

/**
 * The default: AuthZ composed by a process that renders no metrics.
 *
 * It counts and it is deliberately silent, because the alternative shapes are
 * both worse. Refusing to compose without a registry is the state this
 * interface exists to end. Logging every increment would turn two operational
 * counters into a line per revoked grant on a tier whose logs answer different
 * questions — and the events themselves are already logged where they happen:
 * the cutover reporter warns on every failed read, with or without a counter
 * behind it.
 */
export class UncountedAuthzMetrics extends AuthzMetrics {
  static create(): UncountedAuthzMetrics {
    return new UncountedAuthzMetrics();
  }

  private constructor() {
    super();
  }

  revocationCounter(): AuthzCounter {
    return UNCOUNTED;
  }

  engineGateReadFailureCounter(): AuthzCounter {
    return UNCOUNTED;
  }
}

const UNCOUNTED: AuthzCounter = {
  inc(): void {},
};

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
 *
 * This is the ONE module in the feature that names `prom-client`, and
 * {@link AuthzMetrics} is what keeps it that way: a process composes AuthZ
 * with this adapter or without one, and only the former imports a registry.
 */
export class ObservabilityAuthzMetricsAdapter extends AuthzMetrics {
  static create(options: { registry: Registry }): ObservabilityAuthzMetricsAdapter {
    return new ObservabilityAuthzMetricsAdapter(options.registry);
  }

  private constructor(private readonly registry: Registry) {
    super();
  }

  revocationCounter(reason: AuthzRevocationReason): AuthzCounter {
    return this.resolve(DIRECT_PROJECTION_WRITE, ["reason"]).labels(reason);
  }

  engineGateReadFailureCounter(): AuthzCounter {
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
