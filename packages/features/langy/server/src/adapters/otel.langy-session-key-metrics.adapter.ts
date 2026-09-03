import { counter, type CounterHandle } from "@langwatch/observability/metrics";
import { LangySessionKeyMetricsPort } from "../ports/langy-session-key-metrics.port";

/**
 * The series name, pinned because two processes write it.
 *
 * The App writes it through its own `prom-client` registry and a worker
 * composed from packages writes it over OTLP. They are the same lifecycle
 * counter and they carry the same name and the same `op` label on purpose:
 * an operator reading "how many Langy session keys were reaped" must not have
 * to know which process ran the sweep.
 */
export const LANGY_SESSION_KEYS_METRIC_NAME = "langwatch_langy_session_keys_total";

/** Langy session-key lifecycle counts, pushed over OTLP. */
export class OtelLangySessionKeyMetricsAdapter extends LangySessionKeyMetricsPort {
  static create(): OtelLangySessionKeyMetricsAdapter {
    return new OtelLangySessionKeyMetricsAdapter(
      counter({
        name: LANGY_SESSION_KEYS_METRIC_NAME,
        description: "Langy session API keys by lifecycle operation",
      }),
    );
  }

  private constructor(private readonly keys: CounterHandle) {
    super();
  }

  record(input: { operation: "minted" | "revoked" | "reaped"; count?: number }): void {
    this.keys.inc({ op: input.operation }, input.count ?? 1);
  }
}
