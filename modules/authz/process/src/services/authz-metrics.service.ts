import { Counter, type Registry } from "prom-client";
import type { AuthzRevocationReason } from "./authz-revocation-telemetry.service.ts";

/** The one thing AuthZ asks of a metric: that it can be incremented. */
export type AuthzCounter = { inc(): void };

// Interface inverts dependency; metrics optional; when counters move is described once.
export abstract class AuthzMetrics {
  /** Labelled by cause, so one series answers "which kind of direct write". */
  abstract revocationCounter(reason: AuthzRevocationReason): AuthzCounter;

  abstract engineGateReadFailureCounter(): AuthzCounter;
}

// Silent default; refuses without registry which this interface exists to end.
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

// Two series described once; metric names are external interface.
const DIRECT_PROJECTION_WRITE = {
  name: "langwatch_authz_direct_projection_write_total",
  help: "Authorization projection writes that bypassed the group queue, by cause",
} as const;

const ENGINE_GATE_READ_FAILURES = {
  name: "authz_engine_gate_read_failures_total",
  help: "Failed reads of an organization's AuthZ migration state; the organization stays on the legacy path for the cache TTL.",
} as const;

// Resolves counters once per registry; ONE prom-client import module-wide.
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
