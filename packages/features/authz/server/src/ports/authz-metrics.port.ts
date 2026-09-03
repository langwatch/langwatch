import type { AuthzRevocationReason } from "./authz-revocation-telemetry.port";

/** The one thing AuthZ asks of a metric: that it can be incremented. */
export type AuthzCounter = { inc(): void };

/**
 * Where AuthZ's two counters come from.
 *
 * It is a port rather than a `Registry` argument because the registry was the
 * only reason composing this feature required a metrics library at all. The
 * two series are real and an operator reads both — a revocation that bypassed
 * the group queue, and a failed read of an organization's migration state —
 * but neither is a PRECONDITION of authorizing anything. A background process
 * that renders no scrape endpoint could not compose `PostgresAuthzAdapter`
 * while the counters arrived as `prom-client` objects, which is a Prometheus
 * decision reaching into who may hold an `AuthzService`.
 *
 * The port inverts that. A process that renders metrics implements it over its
 * own registry (`ObservabilityAuthzMetricsAdapter`); a process that does not
 * passes nothing and gets {@link UncountedAuthzMetrics}. What stays in the
 * feature either way is WHEN each counter moves, which is the part that must
 * not be described twice.
 */
export abstract class AuthzMetricsPort {
  /** Labelled by cause, so one series answers "which kind of direct write". */
  abstract revocationCounter(reason: AuthzRevocationReason): AuthzCounter;

  abstract engineGateReadFailureCounter(): AuthzCounter;
}

/**
 * The default: AuthZ composed by a process that renders no metrics.
 *
 * It counts and it is deliberately silent, because the alternative shapes are
 * both worse. Refusing to compose without a registry is the state this port
 * exists to end. Logging every increment would turn two operational counters
 * into a line per revoked grant on a tier whose logs answer different
 * questions — and the events themselves are already logged where they happen:
 * the cutover reporter warns on every failed read, with or without a counter
 * behind it.
 */
export class UncountedAuthzMetrics extends AuthzMetricsPort {
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
