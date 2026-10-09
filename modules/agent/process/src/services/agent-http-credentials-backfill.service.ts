import {
  httpAgentConfigSchema,
  httpAgentConfigStoringSecrets,
  type HttpAgentConfig,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { fromDate, type Instant } from "@langwatch/time";

import type { AgentRepository } from "../repositories/agent.repository.ts";
import type { AgentHttpSecretsService } from "./agent-http-secrets.service.ts";

const logger = createLogger("langwatch:agent:http-credentials-backfill");

/** What one pass did; the ledger keeps it. Ids and counts only, never a credential. */
export type AgentHttpCredentialsBackfillReport = {
  afterProjectId: string | null;
  projects: number;
  moved: number;
  held: number;
};

/**
 * Stores credentials typed inline into HTTP agents as project secrets
 * (modules/agent/specs/http-credentials.feature). Level-triggered: an agent counts as moved only
 * when a re-read holds no literal; anything else is held and fails the pass for a retry.
 */
export class AgentHttpCredentialsBackfillService {
  static create(deps: {
    agents: Pick<
      AgentRepository,
      | "findProjectIdsWithHttpAgents"
      | "findAll"
      | "getByIdIncludingArchived"
      | "updateConfigIfUnchanged"
    >;
    httpSecrets: Pick<AgentHttpSecretsService, "forUpdate">;
  }): AgentHttpCredentialsBackfillService {
    return new AgentHttpCredentialsBackfillService(deps);
  }

  private constructor(
    private readonly deps: Parameters<typeof AgentHttpCredentialsBackfillService.create>[0],
  ) {}

  async moveLiterals({
    dryRun,
    signal,
    afterProjectId,
    onProjectDone,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    afterProjectId: string | null;
    onProjectDone: (report: AgentHttpCredentialsBackfillReport) => Promise<void>;
  }): Promise<AgentHttpCredentialsBackfillReport> {
    const report: AgentHttpCredentialsBackfillReport = {
      afterProjectId,
      projects: 0,
      moved: 0,
      held: 0,
    };
    const projectIds = (await this.deps.agents.findProjectIdsWithHttpAgents()).toSorted();
    for (const projectId of projectIds) {
      if (signal.aborted) break;
      if (afterProjectId !== null && projectId <= afterProjectId) continue;
      report.projects += 1;
      await this.moveProject({ projectId, dryRun, report });
      // The cursor stops before the first project with held work, so a retry revisits it.
      if (report.held === 0) report.afterProjectId = projectId;
      if (!dryRun) await onProjectDone({ ...report });
    }
    if (report.held > 0) {
      throw new Error(
        `${report.held} HTTP agent credential(s) could not be stored as project secrets; the worker log names each agent. Retry the step once the cause is fixed.`,
      );
    }

    return report;
  }

  private async moveProject({
    projectId,
    dryRun,
    report,
  }: {
    projectId: string;
    dryRun: boolean;
    report: AgentHttpCredentialsBackfillReport;
  }): Promise<void> {
    for (const agent of await this.deps.agents.findAll({ projectId })) {
      if (agent.type !== "http" || !(await holdsLiteral(agent.config))) continue;
      if (dryRun) {
        report.moved += 1;
        continue;
      }
      await this.moveAgent({
        id: agent.id,
        projectId,
        config: agent.config,
        updatedAt: fromDate(agent.updatedAt),
      });
      const reread = await this.deps.agents.getByIdIncludingArchived({ id: agent.id, projectId });
      if (reread.type === "http" && (await holdsLiteral(reread.config))) {
        report.held += 1;
        logger.warn({ projectId, agentId: agent.id }, "agent credentials held for a retry");
      } else {
        report.moved += 1;
      }
    }
  }

  /** A failure or a save since the read leaves the row as it is; the re-read decides. */
  private async moveAgent(input: {
    id: string;
    projectId: string;
    config: HttpAgentConfig;
    updatedAt: Instant;
  }): Promise<void> {
    const { id, projectId } = input;
    try {
      const command = await this.deps.httpSecrets.forUpdate({
        id,
        projectId,
        config: input.config,
      });
      await this.deps.agents.updateConfigIfUnchanged({
        id,
        projectId,
        config: httpAgentConfigSchema.parse(command.config),
        updatedAt: input.updatedAt,
      });
    } catch (error) {
      logger.warn(
        { projectId, agentId: id, reason: reasonOf(error) },
        "agent credentials not moved",
      );
    }
  }
}

/** Whether the config holds a credential that is not a `{{ secrets.NAME }}` reference. */
async function holdsLiteral(config: HttpAgentConfig): Promise<boolean> {
  let found = false;
  await httpAgentConfigStoringSecrets({
    config,
    owner: "probe",
    reference: async ({ value }) => {
      found = true;
      return value;
    },
  });

  return found;
}

/** The error's kind only: a message may echo the value being stored. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
