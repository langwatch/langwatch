/** Counters Langy's internal control-plane doors publish on the process's Prometheus registry.
 * Every counter is looked up before creation so multiple installs reach the SAME counter. */
import { Counter, register } from "prom-client";

import type { LangyInternalMetrics, LangyRelayFrameMetrics } from "./langy-internal.service.ts";

/** Both counter sets the internal REST family names as facts. */
export type LangyRestMetrics = Readonly<{
  internal: LangyInternalMetrics;
  relayFrames: LangyRelayFrameMetrics;
}>;

/**
 * The same three counters, under the same names, the deleted
 * `apps/api/src/features/langy/langy-rest.mount.ts` registered.
 */
export class LangyRestMetricsPrometheusService implements LangyRestMetrics {
  readonly internal: LangyInternalMetrics;
  readonly relayFrames: LangyRelayFrameMetrics;

  private constructor() {
    const turnResults = counter({
      name: "langwatch_langy_turn_results_total",
      help: "Langy turn results ingested over the durable internal endpoint, by outcome",
      labelNames: ["outcome"],
    });
    const sessionKeys = counter({
      name: "langwatch_langy_session_keys_total",
      help: "Langy session API keys by lifecycle operation",
      labelNames: ["op"],
    });
    const relayFrames = counter({
      name: "langwatch_langy_relay_frames_total",
      help: "Langy relay frames by processing result, summed per stream at close",
      labelNames: ["result"],
    });

    this.internal = {
      turnResult: (outcome) => turnResults.labels(outcome).inc(),
      sessionKeyRevokeRefused: () => sessionKeys.labels("revoke_refused").inc(),
    };
    this.relayFrames = {
      frames: (outcome, count) => relayFrames.labels(outcome).inc(count),
    };
  }

  static create(): LangyRestMetricsPrometheusService {
    return new LangyRestMetricsPrometheusService();
  }
}

function counter(options: {
  name: string;
  help: string;
  labelNames: readonly string[];
}): Counter<string> {
  const existing = register.getSingleMetric(options.name);
  if (existing instanceof Counter) return existing;

  return new Counter({
    name: options.name,
    help: options.help,
    labelNames: [...options.labelNames],
    registers: [register],
  });
}
