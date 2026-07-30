import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  type MetricFactsContributedEvent,
  metricFactsContributedEventSchema,
} from "../schemas/events";

/**
 * One row per converged metric unit of a session (ADR-056 §5): the LWW
 * projection behind `session_metric_series`. A re-observed cumulative total
 * writes a newer version of its series row; a delta point is its own row.
 * The per-session read is `SUM(...) GROUP BY` across the deduplicated units
 * — never an increment on insert.
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
 * The attribute keys the session read actually consumes (the overlay's
 * `type` / `decision` / `language` dimensions). Series identity is already
 * fixed upstream in `seriesId`, so persisting anything beyond these would
 * only copy provider-supplied attributes — which can carry identity like
 * `user.id` / `user.email` — verbatim into a durable table.
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

  constructor(deps: { store: AppendStore<SessionMetricSeriesRecord> }) {
    super();
    this.store = deps.store;
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
