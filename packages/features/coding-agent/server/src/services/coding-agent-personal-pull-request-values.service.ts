import type { CodingAgentSession } from "@langwatch/coding-agent-contract";
import { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service";
import { CodingAgentPullRequestUsageService } from "./coding-agent-pull-request-usage.service";
import type { CodingAgentModelUsage } from "./coding-agent-pull-request-usage.service";

export type CodingAgentPersonalSession = {
  sessionId: string;
  startedAtMs: number;
  lastEventOccurredAtMs: number;
  agent: string;
  headBranch: string;
  headBranches: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  models: string[];
};

export type CodingAgentPersonalRepositoryGroup = {
  repositoryHost: string;
  repositoryFullName: string;
  sessions: CodingAgentPersonalSession[];
};

/** Private value collaborator for the personal pull-request lens. */
export class CodingAgentPersonalPullRequestValuesService {
  static create(options: {
    assignments: CodingAgentPullRequestAssignmentService;
    usage: CodingAgentPullRequestUsageService;
  }): CodingAgentPersonalPullRequestValuesService {
    return new CodingAgentPersonalPullRequestValuesService(options);
  }

  private constructor(
    private readonly dependencies: {
      assignments: CodingAgentPullRequestAssignmentService;
      usage: CodingAgentPullRequestUsageService;
    },
  ) {}

  repositoryGroups(input: {
    sessions: readonly CodingAgentSession[];
    configuredGithubHost: string;
  }): CodingAgentPersonalRepositoryGroup[] {
    const groups = new Map<string, CodingAgentPersonalRepositoryGroup>();
    for (const session of input.sessions) {
      if (!session.repositoryOwner || !session.repositoryName || !session.gitBranch)
        continue;
      const repositoryHost = normalizeGithubHost(
        session.repositoryHost,
        input.configuredGithubHost,
      );
      const repositoryFullName =
        `${session.repositoryOwner}/${session.repositoryName}`.toLowerCase();
      const key = `${repositoryHost} ${repositoryFullName}`;
      const group = groups.get(key) ?? {
        repositoryHost,
        repositoryFullName,
        sessions: [],
      };
      group.sessions.push({
        sessionId: session.sessionId,
        startedAtMs: session.startedAtMs,
        lastEventOccurredAtMs: session.lastEventOccurredAt,
        agent: session.agent,
        headBranch: session.gitBranch,
        headBranches: this.dependencies.assignments.branchesOf(session),
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        cacheReadTokens: session.cacheReadTokens,
        cacheCreationTokens: session.cacheCreationTokens,
        costUsd: session.costUsd,
        models: session.models,
      });
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  unlinkedRows(input: {
    group: CodingAgentPersonalRepositoryGroup;
    sessions: readonly CodingAgentPersonalSession[];
    repoCovered: boolean;
    nonBillableAgents: ReadonlySet<string>;
  }): Array<{
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    lastActivityAtMs: number;
    sessionsCount: number;
    totalTokens: number;
    modelBreakdown: CodingAgentModelUsage[];
    costUsd: number;
    billedCostUsd: number;
    nonBilledCostUsd: number;
    repoCovered: boolean;
  }> {
    const byBranch = new Map<string, CodingAgentPersonalSession[]>();
    for (const session of input.sessions) {
      const rows = byBranch.get(session.headBranch) ?? [];
      rows.push(session);
      byBranch.set(session.headBranch, rows);
    }
    return [...byBranch.entries()].map(([headBranch, sessions]) => ({
      repositoryHost: input.group.repositoryHost,
      repositoryFullName: input.group.repositoryFullName,
      headBranch,
      lastActivityAtMs: sessions.reduce(
        (latest, session) =>
          Math.max(
            latest,
            Math.max(session.startedAtMs, session.lastEventOccurredAtMs || 0),
          ),
        0,
      ),
      sessionsCount: sessions.length,
      totalTokens: sessions.reduce(
        (total, session) => total + this.dependencies.usage.tokenTotal(session),
        0,
      ),
      modelBreakdown: this.namedModels(sessions),
      costUsd: sessions.reduce((total, session) => total + session.costUsd, 0),
      billedCostUsd: sessions
        .filter((session) => !input.nonBillableAgents.has(session.agent))
        .reduce((total, session) => total + session.costUsd, 0),
      nonBilledCostUsd: sessions
        .filter((session) => input.nonBillableAgents.has(session.agent))
        .reduce((total, session) => total + session.costUsd, 0),
      repoCovered: input.repoCovered,
    }));
  }

  private namedModels(
    sessions: readonly { models: string[] }[],
  ): CodingAgentModelUsage[] {
    const models = new Set<string>();
    for (const session of sessions) {
      for (const model of session.models) if (model !== "") models.add(model);
    }
    return [...models].sort().map((model) => ({
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: null,
      tokensKnown: false,
    }));
  }
}

function normalizeGithubHost(host: string, configuredGithubHost: string): string {
  return host === "" ? configuredGithubHost : host.toLowerCase();
}
