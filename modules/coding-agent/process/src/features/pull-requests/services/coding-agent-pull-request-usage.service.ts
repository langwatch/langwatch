import type {
  CodingAgentContributorProject,
  CodingAgentSessionBranchRecord,
} from "@langwatch/coding-agent-contract";

import type { SessionModelTotalsRow } from "../../../repositories/coding-agent-session-event.repository.ts";

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

type CodingAgentContributor = {
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
  aiUnits: number;
};

/**
 * One (session, model, context) total the pull-request reads price: a per-call fact table row, or
 * a span-fed session's own per-model record. AI units are a count; `priced` false is unknown cost.
 */
export type PullRequestModelTotalsRow = SessionModelTotalsRow & {
  aiUnits: number;
  priced: boolean;
};

type CodingAgentUsageTotals = {
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
    if (agent === "gemini_cli") {
      return "gemini";
    }

    if (agent === "copilot") {
      return "github_copilot";
    }

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

  private newUsageRow({
    session,
    priced,
    nonBilled,
    projects,
  }: {
    session: CodingAgentSessionBranchRecord;
    priced: boolean;
    nonBilled: boolean;
    projects: Record<string, CodingAgentContributorProject>;
  }): CodingAgentUsageRow & { modelSet: Set<string> } {
    return {
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
      billedCostUsd: priced ? billedShareOf(session.costUsd, !nonBilled) : null,
      nonBilledCostUsd: priced ? billedShareOf(session.costUsd, nonBilled) : null,
    };
  }

  private addToUsageRow({
    row,
    session,
    priced,
    nonBilled,
  }: {
    row: CodingAgentUsageRow & { modelSet: Set<string> };
    session: CodingAgentSessionBranchRecord;
    priced: boolean;
    nonBilled: boolean;
  }): void {
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

    for (const model of session.models) {
      row.modelSet.add(model);
    }
  }

  groupedRows({
    sessions,
    costProjects,
    nonBillableAgents,
    projects,
  }: {
    sessions: readonly CodingAgentSessionBranchRecord[];
    costProjects: ReadonlySet<string>;
    nonBillableAgents: ReadonlySet<string>;
    projects: Record<string, CodingAgentContributorProject>;
  }): CodingAgentUsageRow[] {
    const grouped = new Map<string, CodingAgentUsageRow & { modelSet: Set<string> }>();
    for (const session of sessions) {
      const key = `${session.tenantId}\0${session.agent}`;
      const priced = costProjects.has(session.tenantId);
      const nonBilled = nonBillableAgents.has(session.agent);
      const row = grouped.get(key);
      if (!row) {
        grouped.set(key, this.newUsageRow({ session, priced, nonBilled, projects }));
        continue;
      }

      this.addToUsageRow({ row, session, priced, nonBilled });
    }

    return [...grouped.values()].map(({ modelSet, ...row }) => ({
      ...row,
      models: [...modelSet].toSorted(),
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

  /**
   * Every session's per-model totals: its per-call fact rows where it has any, else its own
   * per-model record, so a session is never counted from both.
   */
  modelTotalsOf({
    sessions,
    eventTotals,
  }: {
    sessions: readonly CodingAgentSessionBranchRecord[];
    eventTotals: readonly SessionModelTotalsRow[];
  }): PullRequestModelTotalsRow[] {
    const logged = new Set(eventTotals.map((total) => `${total.tenantId}\0${total.sessionId}`));
    const recorded = sessions
      .filter((session) => !logged.has(`${session.tenantId}\0${session.sessionId}`))
      .flatMap((session) =>
        session.usageByModel.map((usage) => ({
          ...usage,
          tenantId: session.tenantId,
          sessionId: session.sessionId,
        })),
      );

    return [...eventTotals.map((total) => ({ ...total, aiUnits: 0, priced: true })), ...recorded];
  }

  modelUsage(
    sessions: readonly CodingAgentSessionBranchRecord[],
    totals: readonly PullRequestModelTotalsRow[],
    costProjects: ReadonlySet<string>,
  ): CodingAgentModelUsage[] {
    const attached = new Set(
      sessions.map((session) => `${session.tenantId}\0${session.sessionId}`),
    );
    const byModel = new Map<string, CodingAgentModelUsage>();
    const unpriced = new Set<string>();
    const withTotals = new Set<string>();
    for (const total of totals) {
      const sessionKey = `${total.tenantId}\0${total.sessionId}`;
      if (!attached.has(sessionKey) || total.model === "") {
        continue;
      }

      withTotals.add(sessionKey);
      if (!total.priced) {
        unpriced.add(total.model);
      }
      byModel.set(
        total.model,
        this.addModelTotal({
          usage: byModel.get(total.model) ?? emptyModelUsage(total.model),
          total,
          costed: costProjects.has(total.tenantId),
        }),
      );
    }

    // A model a session without per-model figures also ran is not fully known: its line would
    // otherwise count only the other sessions while the totals count them all.
    const unrecorded = this.unknownModels(
      sessions.filter((session) => !withTotals.has(`${session.tenantId}\0${session.sessionId}`)),
    );
    const unrecordedModels = new Set(unrecorded.map((usage) => usage.model));
    const known = [...byModel.values()]
      .filter((usage) => !unrecordedModels.has(usage.model))
      .map((usage) => (unpriced.has(usage.model) ? { ...usage, costUsd: null } : usage))
      .toSorted((a, b) => b.totalTokens - a.totalTokens);

    return [...known, ...unrecorded];
  }

  /** One total added onto its model's running usage; AI units never touch the dollar figure. */
  private addModelTotal({
    usage,
    total,
    costed,
  }: {
    usage: CodingAgentModelUsage;
    total: PullRequestModelTotalsRow;
    costed: boolean;
  }): CodingAgentModelUsage {
    return {
      ...usage,
      inputTokens: usage.inputTokens + total.inputTokens,
      outputTokens: usage.outputTokens + total.outputTokens,
      cacheReadTokens: usage.cacheReadTokens + total.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens + total.cacheCreationTokens,
      totalTokens: usage.totalTokens + this.tokenTotal(total),
      costUsd: costed ? (usage.costUsd ?? 0) + total.costUsd : usage.costUsd,
      aiUnits: usage.aiUnits + total.aiUnits,
    };
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
  ): (CodingAgentContributor & { sessionsCount: number })[] {
    const grouped = new Map<string, CodingAgentContributor & { sessionsCount: number }>();
    for (const session of sessions) {
      const current = grouped.get(session.tenantId);
      if (current) {
        current.sessionsCount += 1;
      } else {
        grouped.set(session.tenantId, {
          ...this.contributorFor(session.tenantId, projects),
          sessionsCount: 1,
        });
      }
    }

    return [...grouped.values()].toSorted((a, b) => b.sessionsCount - a.sessionsCount);
  }

  private unknownModels(
    sessions: readonly CodingAgentSessionBranchRecord[],
  ): CodingAgentModelUsage[] {
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
      aiUnits: 0,
    }));
  }
}

function emptyModelUsage(model: string): CodingAgentModelUsage {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    costUsd: null,
    tokensKnown: true,
    aiUnits: 0,
  };
}

function billedShareOf(costUsd: number, applies: boolean): number {
  return applies ? costUsd : 0;
}
