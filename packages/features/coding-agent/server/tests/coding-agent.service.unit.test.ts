import { describe, expect, it } from "vitest";
import { CodingAgentSessionEventRepository } from "../src/repositories/coding-agent-session-event.repository";
import { CodingAgentSessionRepository } from "../src/repositories/coding-agent-session.repository";
import { CodingAgentTraceSessionRepository } from "../src/repositories/coding-agent-trace-session.repository";
import { SessionMetricSeriesRepository } from "../src/repositories/session-metric-series.repository";
import {
  CodingAgentFeatureService,
  MAX_SESSION_EVENTS_PAGE_SIZE,
} from "../src/services/coding-agent.service";

class Sessions extends CodingAgentSessionRepository {
  async findBySessionId() {
    return null;
  }

  async findManyRecent() {
    return [];
  }
}

class TraceSessions extends CodingAgentTraceSessionRepository {
  async findByTraceId() {
    return null;
  }
}

class MetricSeries extends SessionMetricSeriesRepository {
  async findTotalsBySessionIds() {
    return [];
  }
}

class Events extends CodingAgentSessionEventRepository {
  readonly limits: number[] = [];

  async findBySessionId(input: {
    limit: number;
  }): Promise<{ events: []; nextCursor: null }> {
    this.limits.push(input.limit);
    return { events: [], nextCursor: null };
  }
}

describe("CodingAgentFeatureService", () => {
  it("bounds an explicit session-event page at the canonical ceiling", async () => {
    const events = new Events();
    const service = CodingAgentFeatureService.create({
      sessions: new Sessions(),
      traceSessions: new TraceSessions(),
      metricSeries: new MetricSeries(),
      sessionEvents: events,
    });

    await service.getSessionEvents({
      projectId: "project-1",
      sessionId: "session-1",
      occurredAt: { fromMs: 1, toMs: 2 },
      limit: Number.POSITIVE_INFINITY,
    });

    expect(events.limits).toEqual([MAX_SESSION_EVENTS_PAGE_SIZE]);
  });
});
