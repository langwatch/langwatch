import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import type { GithubService } from "@langwatch/github-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { CodingAgentSessionEventRepository } from "../repositories/coding-agent-session-event.repository";
import { CodingAgentSessionRepository } from "../repositories/coding-agent-session.repository";
import { CodingAgentTraceSessionRepository } from "../repositories/coding-agent-trace-session.repository";
import { SessionMetricSeriesRepository } from "../repositories/session-metric-series.repository";
import {
  CodingAgentFeatureService,
  type CodingAgentBillingPolicy,
} from "../services/coding-agent.service";

/** Binds the four private coding-agent read models once at process boot. */
export class CodingAgentAdapter {
  static create(options: {
    sessions: CodingAgentSessionRepository;
    traceSessions: CodingAgentTraceSessionRepository;
    metricSeries: SessionMetricSeriesRepository;
    sessionEvents: CodingAgentSessionEventRepository;
    github: GithubService;
    projects: ProjectService;
    billing: CodingAgentBillingPolicy;
    githubHost?: string;
    now?: () => number;
  }): CodingAgentService {
    return CodingAgentFeatureService.create(options);
  }
}
