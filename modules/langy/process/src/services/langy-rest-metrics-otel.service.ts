/** Counters Langy's internal control-plane doors publish through the metrics facade, pushed
 * over OTLP. The facade resolves one instrument per name, so multiple installs share a series. */
import { counter } from "@langwatch/observability/metrics";

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
export class LangyRestMetricsOtelService implements LangyRestMetrics {
  readonly internal: LangyInternalMetrics;
  readonly relayFrames: LangyRelayFrameMetrics;

  private constructor() {
    const turnResults = counter({
      name: "langwatch_langy_turn_results_total",
      description: "Langy turn results ingested over the durable internal endpoint, by outcome",
    });
    const sessionKeys = counter({
      name: "langwatch_langy_session_keys_total",
      description: "Langy session API keys by lifecycle operation",
    });
    const relayFrames = counter({
      name: "langwatch_langy_relay_frames_total",
      description: "Langy relay frames by processing result, summed per stream at close",
    });

    this.internal = {
      turnResult: (outcome) => turnResults.inc({ outcome }),
      sessionKeyRevokeRefused: () => sessionKeys.inc({ op: "revoke_refused" }),
    };
    this.relayFrames = {
      frames: (outcome, count) => relayFrames.inc({ result: outcome }, count),
    };
  }

  static create(): LangyRestMetricsOtelService {
    return new LangyRestMetricsOtelService();
  }
}
