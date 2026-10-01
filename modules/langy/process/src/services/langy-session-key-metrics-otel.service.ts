import { counter, type CounterHandle } from "@langwatch/observability/metrics";

import { type LangySessionKeyMetrics } from "../app/langy.members.ts";

/** Series name pinned because two processes write it: App via prom-client, worker via OTLP.
 * Same lifecycle counter, name, and op label so operators don't know which process swept. */
export const LANGY_SESSION_KEYS_METRIC_NAME = "langwatch_langy_session_keys_total";

/** Langy session-key lifecycle counts, pushed over OTLP. */
export class LangySessionKeyMetricsOtelService implements LangySessionKeyMetrics {
  static create(): LangySessionKeyMetricsOtelService {
    return new LangySessionKeyMetricsOtelService(
      counter({
        name: LANGY_SESSION_KEYS_METRIC_NAME,
        description: "Langy session API keys by lifecycle operation",
      }),
    );
  }

  private constructor(private readonly keys: CounterHandle) {}

  record(input: { operation: "minted" | "revoked" | "reaped"; count?: number }): void {
    this.keys.inc({ op: input.operation }, input.count ?? 1);
  }
}
