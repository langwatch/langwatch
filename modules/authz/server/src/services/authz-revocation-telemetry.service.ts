export type AuthzRevocationReason = "revocation" | "offboard";

export abstract class AuthzRevocationTelemetry {
  abstract record(args: {
    organizationId: string;
    reason: AuthzRevocationReason;
    grantCount: number;
  }): void;
}

/** The one thing this adapter needs of a metric: that it can be incremented. */
export type AuthzRevocationCounter = { inc(): void };

export type ObservabilityAuthzRevocationAdapterOptions = {
  /** Resolved per record, because the cause is a label rather than a metric. */
  counter(reason: AuthzRevocationReason): AuthzRevocationCounter;
};

// Counts direct writes outside queue; detects when queue is down; one WHEN description.
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
