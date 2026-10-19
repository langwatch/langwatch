import {
  httpAgentConfigSchema,
  httpAgentConfigStoringSecrets,
  type HttpAgentConfig,
} from "@langwatch/agent-contract";
import { createLogger } from "@langwatch/observability";
import { fromDate, type Instant } from "@langwatch/time";

import type { AgentRepository } from "../repositories/agent.repository.ts";
import {
  failureReasonOf,
  heldMessageOf,
  keptReasonOf,
  type AgentCredentialOutcome,
} from "../rules/agent-http-credentials-backfill.rules.ts";
import type { AgentHttpSecretsService } from "./agent-http-secrets.service.ts";

const logger = createLogger("langwatch:agent:http-credentials-backfill");

/** What one pass did; the ledger keeps it. Ids, counts and reason codes, never a credential. */
export type AgentHttpCredentialsBackfillReport = {
  afterProjectId: string | null;
  projects: number;
  moved: number;
  held: number;
  /** Left in place for good: a retry can never move them. */
  kept: AgentCredentialOutcome[];
  /** Held for a retry: these fail the pass. */
  failed: AgentCredentialOutcome[];
};

/** What moving one agent came to before the re-read: written, held, or left for good. */
type MoveOutcome =
  | { kind: "written" }
  | { kind: "held"; reason: string }
  | { kind: "kept"; reason: string };

/**
 * Stores credentials typed inline into HTTP agents as project secrets
 * (modules/agent/specs/http-credentials.feature). Level-triggered: an agent counts as moved only
 * when a re-read holds no literal. A permanent refusal keeps the literal and is reported; anything
 * else is held and fails the pass for a retry.
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
      kept: [],
      failed: [],
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
    if (report.held > 0) throw new Error(heldMessageOf(report.failed));

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
      if (agent.type !== "http") continue;
      // The stored config is validated before the move, so a schema error later is ours to fix.
      if (!httpAgentConfigSchema.safeParse(agent.config).success) {
        if (!dryRun)
          this.record({
            report,
            agent: { agentId: agent.id, projectId },
            outcome: { kind: "kept", reason: "config_invalid" },
          });
        continue;
      }
      if (!(await holdsLiteral(agent.config))) continue;
      if (dryRun) {
        report.moved += 1;
        continue;
      }
      const outcome = await this.moveAgent({
        id: agent.id,
        projectId,
        config: agent.config,
        updatedAt: fromDate(agent.updatedAt),
      });
      this.record({
        report,
        agent: { agentId: agent.id, projectId },
        outcome:
          outcome.kind === "kept"
            ? outcome
            : await this.reread({ agent: { id: agent.id, projectId }, outcome }),
      });
    }
  }

  /** A clean re-read is a move whatever came before; a row gone since the read is kept. */
  private async reread(input: {
    agent: { id: string; projectId: string };
    outcome: Exclude<MoveOutcome, { kind: "kept" }>;
  }): Promise<MoveOutcome> {
    const { agent, outcome } = input;
    try {
      const reread = await this.deps.agents.getByIdIncludingArchived(agent);
      if (reread.type !== "http" || !(await holdsLiteral(reread.config))) {
        return { kind: "written" };
      }
    } catch (error) {
      const reason = keptReasonOf(error);
      if (reason === undefined) throw error;

      return { kind: "kept", reason };
    }

    return outcome.kind === "held" ? outcome : { kind: "held", reason: "saved_during_move" };
  }

  private record(input: {
    report: AgentHttpCredentialsBackfillReport;
    agent: { agentId: string; projectId: string };
    outcome: MoveOutcome;
  }): void {
    const { report, agent, outcome } = input;
    if (outcome.kind === "written") {
      report.moved += 1;
    } else if (outcome.kind === "kept") {
      report.kept.push({ ...agent, reason: outcome.reason });
      logger.warn({ ...agent, reason: outcome.reason }, "agent credentials left in place for good");
    } else {
      report.held += 1;
      report.failed.push({ ...agent, reason: outcome.reason });
      logger.warn({ ...agent, reason: outcome.reason }, "agent credentials held for a retry");
    }
  }

  /** A failure or a save since the read leaves the row as it is; the re-read decides. */
  private async moveAgent(input: {
    id: string;
    projectId: string;
    config: HttpAgentConfig;
    updatedAt: Instant;
  }): Promise<MoveOutcome> {
    const { id, projectId } = input;
    try {
      const command = await this.deps.httpSecrets.forUpdate({
        id,
        projectId,
        config: input.config,
      });
      const written = await this.deps.agents.updateConfigIfUnchanged({
        id,
        projectId,
        config: httpAgentConfigSchema.parse(command.config),
        updatedAt: input.updatedAt,
      });

      return written ? { kind: "written" } : { kind: "held", reason: "saved_during_move" };
    } catch (error) {
      const kept = keptReasonOf(error);

      return kept === undefined
        ? { kind: "held", reason: failureReasonOf(error) }
        : { kind: "kept", reason: kept };
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
