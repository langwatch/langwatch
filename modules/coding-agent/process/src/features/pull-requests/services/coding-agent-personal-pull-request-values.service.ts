import type { CodingAgentSession } from "@langwatch/coding-agent-contract";

import { isCostUnknown } from "../../../rules/coding-agent-pull-request.rules.ts";
import type { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service.ts";
import type {
  CodingAgentPullRequestUsageService,
  CodingAgentModelUsage,
} from "./coding-agent-pull-request-usage.service.ts";

type CodingAgentPersonalSession = {
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
  isCostKnown: boolean;
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
      if (!session.repositoryOwner || !session.repositoryName || !session.gitBranch) {
        continue;
      }

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
        isCostKnown: !isCostUnknown(
          session.models.map((model) => ({
            priced: this.dependencies.usage.isPricedAs({ agent: session.agent, model }),
          })),
        ),
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
  }): {
    repositoryHost: string;
    repositoryFullName: string;
    headBranch: string;
    lastActivityAtMs: number;
    sessionsCount: number;
    totalTokens: number;
    modelBreakdown: CodingAgentModelUsage[];
    costUsd: number | null;
    billedCostUsd: number | null;
    nonBilledCostUsd: number | null;
    repoCovered: boolean;
  }[] {
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
          Math.max(latest, Math.max(session.startedAtMs, session.lastEventOccurredAtMs || 0)),
        0,
      ),
      sessionsCount: sessions.length,
      totalTokens: sessions.reduce(
        (total, session) => total + this.dependencies.usage.tokenTotal(session),
        0,
      ),
      modelBreakdown: this.namedModels(sessions),
      ...this.costSplit({ sessions, nonBillableAgents: input.nonBillableAgents }),
      repoCovered: input.repoCovered,
    }));
  }

  /** The branch's cost split; unknown when no session on it had a known price. */
  private costSplit({
    sessions,
    nonBillableAgents,
  }: {
    sessions: readonly CodingAgentPersonalSession[];
    nonBillableAgents: ReadonlySet<string>;
  }): { costUsd: number | null; billedCostUsd: number | null; nonBilledCostUsd: number | null } {
    const priced = sessions.filter((session) => session.isCostKnown);
    if (priced.length === 0) {
      return { costUsd: null, billedCostUsd: null, nonBilledCostUsd: null };
    }

    const sum = (of: readonly CodingAgentPersonalSession[]) =>
      of.reduce((total, session) => total + session.costUsd, 0);
    return {
      costUsd: sum(priced),
      billedCostUsd: sum(priced.filter((session) => !nonBillableAgents.has(session.agent))),
      nonBilledCostUsd: sum(priced.filter((session) => nonBillableAgents.has(session.agent))),
    };
  }

  private namedModels(sessions: readonly { models: string[] }[]): CodingAgentModelUsage[] {
    const models = new Set<string>();
    for (const session of sessions) {
      for (const model of session.models) {
        if (model !== "") {
          models.add(model);
        }
      }
    }

    return [...models].toSorted().map((model) => ({
      model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: null,
      tokensKnown: false,
      aiUnits: null,
    }));
  }
}

function normalizeGithubHost(host: string, configuredGithubHost: string): string {
  return host === "" ? configuredGithubHost : host.toLowerCase();
}
