/**
 * Whether each Flight Deck source ever recorded a row for a project (spec:
 * dashboards-v1.feature, AC6/AC7/AC25). Asked through the analytics peer's
 * LangWatchQL path, as the member, so it is tenant-scoped like every panel.
 */
import type { AnalyticsApi, LangWatchQLRunCaller } from "@langwatch/analytics-contract";
import {
  DASHBOARD_SOURCES,
  dashboardSourcePresenceSchema,
  type DashboardSource,
  type DashboardSourcePresence,
  type DashboardSourcePresenceState,
} from "@langwatch/dashboard-contract";
import { createLogger, type Logger } from "@langwatch/observability";

const logger: Pick<Logger, "warn"> = createLogger("langwatch:dashboard:source-presence");

/** One cheap "any row ever" statement per source: no period, so a quiet week is not "never". */
const SOURCE_EXISTENCE_SQL: Readonly<Record<DashboardSource, string>> = {
  traces: "SELECT 1 AS present FROM trace_metrics LIMIT 1",
  scenarios: "SELECT 1 AS present FROM simulations LIMIT 1",
  judges: "SELECT 1 AS present FROM evaluation_metrics LIMIT 1",
  feedback: "SELECT 1 AS present FROM annotations LIMIT 1",
  gateway: "SELECT 1 AS present FROM gateway_request_spend LIMIT 1",
  codingAgents: "SELECT 1 AS present FROM coding_sessions LIMIT 1",
};

type SourcePresenceAnalytics = Pick<AnalyticsApi, "resolveRunCaller" | "executeLangWatchQL">;

/** The per-source answer the Flight Deck decides call-to-action versus data from. */
export class SourcePresenceService {
  #analytics: SourcePresenceAnalytics;

  private constructor(analytics: SourcePresenceAnalytics) {
    this.#analytics = analytics;
  }

  static create(options: { analytics: SourcePresenceAnalytics }): SourcePresenceService {
    return new SourcePresenceService(options.analytics);
  }

  async getPresence(input: {
    projectId: string;
    userId: string;
  }): Promise<DashboardSourcePresence> {
    const caller = await this.#analytics.resolveRunCaller(input);

    const states = await Promise.all(
      DASHBOARD_SOURCES.map(async (source) => [source, await this.#probe({ caller, source })]),
    );

    return dashboardSourcePresenceSchema.parse(Object.fromEntries(states));
  }

  /**
   * A source whose statement fails answers `failed`, never `absent`: a broken
   * query must show an error with a retry, not invite the member to connect
   * something that may already be connected (AC23).
   */
  async #probe(input: {
    caller: LangWatchQLRunCaller;
    source: DashboardSource;
  }): Promise<DashboardSourcePresenceState> {
    try {
      const result = await this.#analytics.executeLangWatchQL({
        ...input.caller,
        sql: SOURCE_EXISTENCE_SQL[input.source],
      });
      return result.rows.length > 0 ? "present" : "absent";
    } catch (error) {
      logger.warn({ error, source: input.source }, "dashboard source presence query failed");
      return "failed";
    }
  }
}
