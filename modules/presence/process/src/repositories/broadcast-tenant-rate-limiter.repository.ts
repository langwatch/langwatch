export interface BucketConfig {
  /** Maximum tokens (burst size). */
  capacity: number;
  /** Tokens added per second. */
  refillRate: number;
}

export interface TierConfig {
  /** START, END, RUN_FINISHED, RUN_STARTED */
  structural: BucketConfig;
  /** CONTENT, TOOL_CALL_ARGS */
  delta: BucketConfig;
}

/** A per-tenant token bucket the broadcast fabric spends before it sends or relays. */
export interface BroadcastTenantRateLimiterRepository {
  start(): void;
  /** `true` if the event is allowed, `false` if rate-limited. */
  consume(tenantId: string, tier: "structural" | "delta"): boolean;
  destroy(): void;
}
