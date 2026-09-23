import { normalizeMetricName } from "@langwatch/coding-agent-contract";

import {
  type CodingAgentSessionStateProjection,
  type CodingAgentSessionData,
  type MetricSeriesFact,
} from "./coding-agent-session-state.projection.ts";

const MAX_METRIC_SERIES = 200;

type MetricOverlayTotals = Pick<
  CodingAgentSessionData,
  | "linesAdded"
  | "linesRemoved"
  | "commits"
  | "pullRequests"
  | "editsAccepted"
  | "editsRejected"
  | "activeTimeUserSec"
  | "activeTimeCliSec"
  | "languagesEdited"
>;

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
    const totals: MetricOverlayTotals = {
      linesAdded: 0,
      linesRemoved: 0,
      commits: 0,
      pullRequests: 0,
      editsAccepted: 0,
      editsRejected: 0,
      activeTimeUserSec: 0,
      activeTimeCliSec: 0,
      languagesEdited: [],
    };

    for (const fact of Object.values(state.metricSeries)) {
      this.accumulateMetricFact(totals, fact);
    }

    return {
      ...state,
      linesAdded: totals.linesAdded,
      linesRemoved: totals.linesRemoved,
      commits: Math.round(totals.commits),
      pullRequests: Math.round(totals.pullRequests),
      editsAccepted: Math.round(totals.editsAccepted),
      editsRejected: Math.round(totals.editsRejected),
      activeTimeUserSec: totals.activeTimeUserSec,
      activeTimeCliSec: totals.activeTimeCliSec,
      languagesEdited: totals.languagesEdited,
    };
  }

  private accumulateMetricFact(totals: MetricOverlayTotals, fact: MetricSeriesFact): void {
    switch (normalizeMetricName(fact.metricName)) {
      case "lines_of_code":
        if (fact.type === "added") totals.linesAdded += fact.value;
        if (fact.type === "removed") totals.linesRemoved += fact.value;
        break;
      case "commit":
        totals.commits += fact.value;
        break;
      case "pull_request":
        totals.pullRequests += fact.value;
        break;
      case "edit_decision":
        if (fact.decision === "accept") totals.editsAccepted += fact.value;
        else totals.editsRejected += fact.value;
        if (fact.language !== null && fact.language !== "unknown") {
          totals.languagesEdited = this.stateProjection.addToBoundedSet(
            totals.languagesEdited,
            fact.language,
          );
        }
        break;
      case "active_time":
        if (fact.type === "user") totals.activeTimeUserSec += fact.value;
        if (fact.type === "cli") totals.activeTimeCliSec += fact.value;
        break;
      default:
        break;
    }
  }
}
