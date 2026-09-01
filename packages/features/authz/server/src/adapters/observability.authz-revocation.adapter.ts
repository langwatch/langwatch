import {
  AuthzRevocationTelemetry,
  type AuthzRevocationReason,
} from "../ports/authz-revocation-telemetry.port";

/** The one thing this adapter needs of a metric: that it can be incremented. */
export type AuthzRevocationCounter = { inc(): void };

export type ObservabilityAuthzRevocationAdapterOptions = {
  /** Resolved per record, because the cause is a label rather than a metric. */
  counter(reason: AuthzRevocationReason): AuthzRevocationCounter;
};

/**
 * Counts the two projection writes that deliberately bypass the group queue.
 *
 * Every other AuthZ write is a queued command; a revocation and an offboarding
 * additionally apply their deny effect straight to the projection, because both
 * can only ever make a denial true EARLIER. That is also why the count matters:
 * a direct write is the one path whose effect is not recorded as an event when
 * the queue is down — the deny lands in Postgres, the event never appends, and
 * a later replay would resurrect the access. This counter is how an operator
 * knows that window happened and how wide it was.
 *
 * The counter arrives as an argument, exactly as the cutover reporter's does,
 * so the metric registry stays the composing process's business and this
 * adapter stays the one description of WHEN to increment. Two processes writing
 * the same series described two ways is how the series stops meaning one thing.
 */
export class ObservabilityAuthzRevocationAdapter extends AuthzRevocationTelemetry {
  static create(
    options: ObservabilityAuthzRevocationAdapterOptions,
  ): ObservabilityAuthzRevocationAdapter {
    return new ObservabilityAuthzRevocationAdapter(options);
  }

  private constructor(private readonly options: ObservabilityAuthzRevocationAdapterOptions) {
    super();
  }

  record({
    reason,
  }: {
    organizationId: string;
    reason: AuthzRevocationReason;
    grantCount: number;
  }): void {
    this.options.counter(reason).inc();
  }
}
