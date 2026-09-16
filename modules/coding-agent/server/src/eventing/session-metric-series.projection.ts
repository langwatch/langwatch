import type { AppendStore } from "@langwatch/eventing";
import { AbstractMapProjection, type MapEventHandlers } from "@langwatch/eventing";
import { CODING_AGENT_MAP_COALESCE_MAX_BATCH } from "@langwatch/coding-agent-contract";
import {
  type MetricFactsContributedEvent,
  metricFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";

/**
 * One row per converged metric unit of a session (ADR-056 §5), the LWW
 * projection behind `session_metric_series`: a cumulative total writes a
 * newer row version, a delta point its own row — summed via `GROUP BY`, never incremented.
 */
export interface SessionMetricSeriesRecord {
  tenantId: string;
  sessionId: string;
  seriesId: string;
  metricName: string;
  metricUnit: string;
  agent: string;
  attributes: Record<string, string>;
  value: number;
  dataPointCount: number;
  /** Observation time of the newest folded point — the LWW version. */
  asOfUnixMs: number;
}

/**
 * The attribute keys the session read actually consumes (`type`/`decision`/
 * `language`). Series identity is already fixed in `seriesId`, so persisting
 * more would copy provider attributes — including identity like `user.id` — verbatim.
 */
const PERSISTED_ATTRIBUTE_KEYS = new Set(["type", "decision", "language"]);

const events = [metricFactsContributedEventSchema] as const;

export class SessionMetricSeriesMapProjection
  extends AbstractMapProjection<SessionMetricSeriesRecord, typeof events>
  implements MapEventHandlers<typeof events, SessionMetricSeriesRecord>
{
  readonly name = "sessionMetricSeries";
  readonly store: AppendStore<SessionMetricSeriesRecord>;
  protected readonly events = events;

  private constructor(deps: { store: AppendStore<SessionMetricSeriesRecord> }) {
    super();
    this.store = deps.store;
    this.options = {
      coalesceMaxBatch: CODING_AGENT_MAP_COALESCE_MAX_BATCH,
    };
  }

  static create(deps: {
    store: AppendStore<SessionMetricSeriesRecord>;
  }): SessionMetricSeriesMapProjection {
    return new SessionMetricSeriesMapProjection(deps);
  }

  mapCodingAgentSessionMetricFactsContributed(
    event: MetricFactsContributedEvent,
  ): SessionMetricSeriesRecord {
    const data = event.data;
    return {
      tenantId: data.tenantId,
      sessionId: data.sessionId,
      seriesId: data.seriesId,
      metricName: data.metricName,
      metricUnit: data.unit ?? "",
      agent: data.agent,
      attributes: Object.fromEntries(
        Object.entries(data.attributes)
          .filter(([key]) => PERSISTED_ATTRIBUTE_KEYS.has(key))
          .map(([key, value]) => [key, String(value)]),
      ),
      value: data.value,
      dataPointCount: data.dataPointCount,
      asOfUnixMs: data.asOfUnixMs,
    };
  }
}
