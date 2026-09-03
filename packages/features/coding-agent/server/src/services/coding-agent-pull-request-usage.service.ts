import type {
  CodingAgentContributorProject,
  CodingAgentSessionBranchRecord,
} from "@langwatch/coding-agent-contract";
import type { SessionModelTotalsRow } from "../repositories/coding-agent-session-event.repository";

export type CodingAgentUsageRow = {
  projectId: string;
  projectSlug: string;
  contributorLabel: string;
  contributorIsProject: boolean;
  agent: string;
  models: string[];
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
  billedCostUsd: number | null;
  nonBilledCostUsd: number | null;
};

export type CodingAgentContributor = {
  projectId: string;
  projectSlug: string;
  contributorLabel: string;
  contributorIsProject: boolean;
};

export type CodingAgentModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
  tokensKnown: boolean;
};

export type CodingAgentUsageTotals = {
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
  billedCostUsd: number | null;
  nonBilledCostUsd: number | null;
};

/** Private value collaborator that keeps usage aggregation consistent across reads. */
export class CodingAgentPullRequestUsageService {
  static create(): CodingAgentPullRequestUsageService {
    return new CodingAgentPullRequestUsageService();
  }

  private constructor() {}

  ingestSourceType(agent: string): string {
    if (agent === "gemini_cli") return "gemini";
    if (agent === "copilot") return "github_copilot";
    return agent;
  }

  contributorFor(
    projectId: string,
    projects: Record<string, CodingAgentContributorProject>,
  ): CodingAgentContributor {
    const project = projects[projectId];
    return {
      projectId,
      projectSlug: project?.slug ?? "",
      contributorLabel: project?.contributorLabel ?? projectId,
      contributorIsProject: project?.isLinkable ?? false,
    };
  }

  tokenTotal(row: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  }): number {
    return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheCreationTokens;
  }

  groupedRows(
    sessions: readonly CodingAgentSessionBranchRecord[],
    costProjects: ReadonlySet<string>,
    nonBillableAgents: ReadonlySet<string>,
    projects: Record<string, CodingAgentContributorProject>,
  ): CodingAgentUsageRow[] {
    const grouped = new Map<string, CodingAgentUsageRow & { modelSet: Set<string> }>();
    for (const session of sessions) {
      const key = `${session.tenantId}\0${session.agent}`;
      const priced = costProjects.has(session.tenantId);
      const nonBilled = nonBillableAgents.has(session.agent);
      const row = grouped.get(key);
      if (!row) {
        grouped.set(key, {
          ...this.contributorFor(session.tenantId, projects),
          agent: session.agent,
          models: [],
          modelSet: new Set(session.models),
          sessionsCount: 1,
          inputTokens: session.inputTokens,
          outputTokens: session.outputTokens,
          cacheReadTokens: session.cacheReadTokens,
          cacheCreationTokens: session.cacheCreationTokens,
          totalTokens: this.tokenTotal(session),
          costUsd: priced ? session.costUsd : null,
          billedCostUsd: priced ? (nonBilled ? 0 : session.costUsd) : null,
          nonBilledCostUsd: priced ? (nonBilled ? session.costUsd : 0) : null,
        });
        continue;
      }
      row.sessionsCount += 1;
      row.inputTokens += session.inputTokens;
      row.outputTokens += session.outputTokens;
      row.cacheReadTokens += session.cacheReadTokens;
      row.cacheCreationTokens += session.cacheCreationTokens;
      row.totalTokens += this.tokenTotal(session);
      if (priced) {
        row.costUsd = (row.costUsd ?? 0) + session.costUsd;
        row.billedCostUsd = (row.billedCostUsd ?? 0) + (nonBilled ? 0 : session.costUsd);
        row.nonBilledCostUsd = (row.nonBilledCostUsd ?? 0) + (nonBilled ? session.costUsd : 0);
      }
      for (const model of session.models) row.modelSet.add(model);
    }
    return [...grouped.values()].map(({ modelSet, ...row }) => ({
      ...row,
      models: [...modelSet].sort(),
    }));
  }

  totals(rows: readonly CodingAgentUsageRow[]): CodingAgentUsageTotals {
    const empty: CodingAgentUsageTotals = {
      sessionsCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      costUsd: null,
      billedCostUsd: null,
      nonBilledCostUsd: null,
    };
    return rows.reduce<CodingAgentUsageTotals>(
      (totals, row) => ({
        sessionsCount: totals.sessionsCount + row.sessionsCount,
        inputTokens: totals.inputTokens + row.inputTokens,
        outputTokens: totals.outputTokens + row.outputTokens,
        cacheReadTokens: totals.cacheReadTokens + row.cacheReadTokens,
        cacheCreationTokens: totals.cacheCreationTokens + row.cacheCreationTokens,
        totalTokens: totals.totalTokens + row.totalTokens,
        costUsd: row.costUsd === null ? totals.costUsd : (totals.costUsd ?? 0) + row.costUsd,
        billedCostUsd:
          row.billedCostUsd === null
            ? totals.billedCostUsd
            : (totals.billedCostUsd ?? 0) + row.billedCostUsd,
        nonBilledCostUsd:
          row.nonBilledCostUsd === null
            ? totals.nonBilledCostUsd
            : (totals.nonBilledCostUsd ?? 0) + row.nonBilledCostUsd,
      }),
      empty,
    );
  }

  modelUsage(
    sessions: readonly CodingAgentSessionBranchRecord[],
    totals: readonly SessionModelTotalsRow[],
    costProjects: ReadonlySet<string>,
  ): CodingAgentModelUsage[] {
    const attached = new Set(
      sessions.map((session) => `${session.tenantId}\0${session.sessionId}`),
    );
    const byModel = new Map<string, CodingAgentModelUsage>();
    for (const total of totals) {
      if (!attached.has(`${total.tenantId}\0${total.sessionId}`) || total.model === "") {
        continue;
      }
      const existing = byModel.get(total.model) ?? {
        model: total.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        costUsd: null,
        tokensKnown: true,
      };
      existing.inputTokens += total.inputTokens;
      existing.outputTokens += total.outputTokens;
      existing.cacheReadTokens += total.cacheReadTokens;
      existing.cacheCreationTokens += total.cacheCreationTokens;
      existing.totalTokens += this.tokenTotal(total);
      if (costProjects.has(total.tenantId)) {
        existing.costUsd = (existing.costUsd ?? 0) + total.costUsd;
      }
      byModel.set(total.model, existing);
    }
    if (byModel.size > 0) {
      return [...byModel.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    }
    return this.unknownModels(sessions);
  }

  latestActivity(sessions: readonly CodingAgentSessionBranchRecord[]): number {
    return sessions.reduce(
      (latest, session) =>
        Math.max(latest, Math.max(session.startedAtMs, session.lastEventOccurredAtMs || 0)),
      0,
    );
  }

  contributorsSummary(
    sessions: readonly CodingAgentSessionBranchRecord[],
    projects: Record<string, CodingAgentContributorProject>,
  ): Array<CodingAgentContributor & { sessionsCount: number }> {
    const grouped = new Map<string, CodingAgentContributor & { sessionsCount: number }>();
    for (const session of sessions) {
      const current = grouped.get(session.tenantId);
      if (current) current.sessionsCount += 1;
      else {
        grouped.set(session.tenantId, {
          ...this.contributorFor(session.tenantId, projects),
          sessionsCount: 1,
        });
      }
    }
    return [...grouped.values()].sort((a, b) => b.sessionsCount - a.sessionsCount);
  }

  private unknownModels(
    sessions: readonly CodingAgentSessionBranchRecord[],
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
