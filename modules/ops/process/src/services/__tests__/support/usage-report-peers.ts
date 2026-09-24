import { AuthUnavailableError } from "@langwatch/auth-contract";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";

import type { UsageReportPeers } from "../../usage-report-collection.service.ts";

/** A figure one owner module counts, as a row on the day it happened. */
export type IngestedFigure =
  | "traces"
  | "spans"
  | "scenario_runs"
  | "instant_eval_runs"
  | "instant_eval_judgments"
  | "coding_agent_sessions"
  | "gateway";

export interface IngestedRow {
  readonly projectId: string;
  readonly figure: IngestedFigure;
  readonly at: number;
  readonly costUsd?: number;
}

/** The install as its owner modules would count it, held in memory. */
export class UsageReportWorld {
  readonly projectsByOrganization = new Map<string, string[]>();
  readonly rows: IngestedRow[] = [];
  emailDomains: Record<string, number> = {};
  /** The sign-in mode auth names; absent reads as a process that composes none. */
  authProvider: string | undefined = "email";
  mailProvider: string | undefined = undefined;
  storageDestination: StoredObjectStorageDestination = { kind: "file", root: "/var/lib/langwatch" };

  static create(): UsageReportWorld {
    return new UsageReportWorld();
  }

  /** Every owner, each answering from this world through its own `countUsage`. */
  peers(): UsageReportPeers {
    const count =
      (figure: IngestedFigure) => (input: { projectIds: readonly string[]; since?: number }) =>
        this.matching(figure, input);
    const first = (figure: IngestedFigure, projectIds: readonly string[]) => {
      const days = this.matching(figure, { projectIds }).map((row) => row.at);
      return days.length === 0 ? undefined : Math.min(...days);
    };
    return {
      organizations: {
        countUsage: async () => ({ members: 1, teams: 1, ssoProviders: [] }),
      },
      projects: {
        listIdsByOrganization: async ({ organizationId }) =>
          this.projectsByOrganization.get(organizationId) ?? [],
        countUsage: async () => ({ projects: 0, updatedProjects: 0 }),
      },
      users: { countUsage: async () => ({ emailDomains: this.emailDomains }) },
      auth: {
        countUsage: async () => ({ signedInUsers: 0 }),
        resolveAuthProvider: async () => {
          if (this.authProvider === undefined) {
            throw new AuthUnavailableError({ capability: "sign-in mode", processName: "test" });
          }
          return this.authProvider;
        },
      },
      datasets: {
        countUsage: async () => ({ datasets: 0, datasetRecords: 0, batchEvaluations: 0 }),
      },
      annotations: {
        countUsage: async () => ({
          annotations: 0,
          annotationQueues: 0,
          annotationQueueItems: 0,
          annotationScores: 0,
        }),
      },
      monitors: { countUsage: async () => ({ monitors: 0 }) },
      experiments: { countUsage: async () => ({ experiments: 0 }) },
      prompts: { countUsage: async () => ({ prompts: 0 }) },
      workflows: { countUsage: async () => ({ workflows: 0 }) },
      automations: { countUsage: async () => ({ triggers: 0 }) },
      github: { countUsage: async () => ({ pullRequests: 0 }) },
      langy: { countUsage: async () => ({ turns: 0, activeUsers: 0 }) },
      dashboards: { countUsage: async () => ({ builderCharts: 0 }) },
      modelProviders: { countUsage: async () => ({ providers: [] }) },
      traces: {
        countUsage: async (input) => ({
          traces: count("traces")(input).length,
          spans: count("spans")(input).length,
        }),
      },
      scenarios: {
        countUsage: async (input) => ({ runs: count("scenario_runs")(input).length }),
      },
      instantEvals: {
        countUsage: async (input) => {
          const firstRunAt = first("instant_eval_runs", input.projectIds);
          return {
            runs: count("instant_eval_runs")(input).length,
            judgments: count("instant_eval_judgments")(input).length,
            ...(firstRunAt === undefined ? {} : { firstRunAt }),
          };
        },
      },
      codingAgents: {
        countUsage: async (input) => {
          const firstSessionAt = first("coding_agent_sessions", input.projectIds);
          return {
            sessions: count("coding_agent_sessions")(input).length,
            ...(firstSessionAt === undefined ? {} : { firstSessionAt }),
          };
        },
      },
      gateway: {
        countUsage: async (input) => {
          const rows = count("gateway")(input);
          const firstRequestAt = first("gateway", input.projectIds);
          return {
            requests: rows.length,
            spendUsd: rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
            ...(firstRequestAt === undefined ? {} : { firstRequestAt }),
          };
        },
      },
      mail: {
        getMailDelivery: async () => ({
          ...(this.mailProvider === undefined ? {} : { provider: this.mailProvider }),
          smtpConfigured: this.mailProvider === "smtp",
        }),
      },
      storage: { getStorageDestination: async () => this.storageDestination },
    };
  }

  private matching(
    figure: IngestedFigure,
    { projectIds, since }: { projectIds: readonly string[]; since?: number },
  ): IngestedRow[] {
    return this.rows.filter(
      (row) =>
        row.figure === figure &&
        projectIds.includes(row.projectId) &&
        (since === undefined || row.at >= since),
    );
  }
}
