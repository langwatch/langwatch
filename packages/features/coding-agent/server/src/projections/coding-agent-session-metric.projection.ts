import { normalizeMetricName } from "@langwatch/coding-agent-contract";
import {
  type CodingAgentSessionData,
  type MetricSeriesFact,
  CodingAgentSessionStateProjection,
} from "./coding-agent-session-state.projection";

const MAX_METRIC_SERIES = 200;

export interface MetricFactsView {
  seriesId: string;
  metricName: string;
  attributes: Record<string, unknown>;
  value: number;
}

export interface CodingAgentSessionMetricProjectionInput {
  state: CodingAgentSessionData;
  metric: MetricFactsView;
}

/** Deterministically converges metric units and recomputes metric-fed fields. */
export class CodingAgentSessionMetricProjection {
  private constructor(private readonly stateProjection: CodingAgentSessionStateProjection) {}

  static create(deps: {
    stateProjection: CodingAgentSessionStateProjection;
  }): CodingAgentSessionMetricProjection {
    return new CodingAgentSessionMetricProjection(deps.stateProjection);
  }

  applyMetricToCodingAgentSession({
    state,
    metric,
  }: CodingAgentSessionMetricProjectionInput): CodingAgentSessionData {
    const base = this.stateProjection.withIdentity(state, metric.attributes);
    if (normalizeMetricName(metric.metricName) === null) return base;

    const isNewUnit = state.metricSeries[metric.seriesId] === undefined;
    if (isNewUnit && Object.keys(state.metricSeries).length >= MAX_METRIC_SERIES) {
      return base;
    }

    const attrs = metric.attributes;
    const fact: MetricSeriesFact = {
      metricName: metric.metricName,
      type: this.stateProjection.string(attrs.type),
      decision: this.stateProjection.string(attrs.decision),
      language: this.stateProjection.string(attrs.language),
      value: this.total(metric.value),
    };

    return this.recomputeMetricOverlay({
      ...base,
      metricSeries: { ...base.metricSeries, [metric.seriesId]: fact },
    });
  }

  private total(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private recomputeMetricOverlay(state: CodingAgentSessionData): CodingAgentSessionData {
    let linesAdded = 0;
    let linesRemoved = 0;
    let commits = 0;
    let pullRequests = 0;
    let editsAccepted = 0;
    let editsRejected = 0;
    let activeTimeUserSec = 0;
    let activeTimeCliSec = 0;
    let languagesEdited: string[] = [];

    for (const fact of Object.values(state.metricSeries)) {
      switch (normalizeMetricName(fact.metricName)) {
        case "lines_of_code":
          if (fact.type === "added") linesAdded += fact.value;
          if (fact.type === "removed") linesRemoved += fact.value;
          break;
        case "commit":
          commits += fact.value;
          break;
        case "pull_request":
          pullRequests += fact.value;
          break;
        case "edit_decision":
          if (fact.decision === "accept") editsAccepted += fact.value;
          else editsRejected += fact.value;
          if (fact.language !== null && fact.language !== "unknown") {
            languagesEdited = this.stateProjection.addToBoundedSet(languagesEdited, fact.language);
          }
          break;
        case "active_time":
          if (fact.type === "user") activeTimeUserSec += fact.value;
          if (fact.type === "cli") activeTimeCliSec += fact.value;
          break;
        default:
          break;
      }
    }

    return {
      ...state,
      linesAdded,
      linesRemoved,
      commits: Math.round(commits),
      pullRequests: Math.round(pullRequests),
      editsAccepted: Math.round(editsAccepted),
      editsRejected: Math.round(editsRejected),
      activeTimeUserSec,
      activeTimeCliSec,
      languagesEdited,
    };
  }
}
