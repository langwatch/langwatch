/**
 * Writes the ledger row for one Instant Evals judge call from the judge's priced fact (ADR-174
 * decision 13), looking up the team through gateway's own project dependency. The meter reads
 * the row unchanged. Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { GatewayPricedSpend, GatewayPricedSpendResult } from "@langwatch/gateway-contract";
import type { InstantEvalJudgeSpendPricedEventData } from "@langwatch/instant-eval-judge-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import { gatewayPricedSpendOfJudge } from "../rules/gateway-instant-eval-judge-spend.rules.ts";

const defaultLogger: Logger = createLogger("langwatch:gateway:instant-eval-judge-spend");

type GatewayInstantEvalJudgeSpendDeps = Readonly<{
  projects: Pick<ProjectApi, "findWithTeam">;
  /** The spend spine's priced append, keyed by request id, so a repeat is one row. */
  recordPricedSpend: (input: GatewayPricedSpend) => Promise<GatewayPricedSpendResult>;
  logger?: Pick<Logger, "error">;
}>;

export class GatewayInstantEvalJudgeSpendService {
  private readonly logger: Pick<Logger, "error">;

  private constructor(private readonly deps: GatewayInstantEvalJudgeSpendDeps) {
    this.logger = deps.logger ?? defaultLogger;
  }

  static create(deps: GatewayInstantEvalJudgeSpendDeps): GatewayInstantEvalJudgeSpendService {
    return new GatewayInstantEvalJudgeSpendService(deps);
  }

  async recordJudgeSpend({ fact }: { fact: InstantEvalJudgeSpendPricedEventData }): Promise<void> {
    const project = await this.deps.projects.findWithTeam(fact.projectId);
    if (!project) {
      // A deleted project has no team to bill; a redelivery would find none either.
      this.logger.error(
        {
          organizationId: fact.organizationId,
          projectId: fact.projectId,
          requestId: fact.requestId,
          priceNanoUsd: fact.priceNanoUsd,
        },
        "Instant Evals judge spend not written to the ledger: the project has no team",
      );
      return;
    }
    const { status } = await this.deps.recordPricedSpend(
      gatewayPricedSpendOfJudge({ fact, teamId: project.team.id }),
    );
    // Throw so the fact is delivered again: a dropped row is usage given away.
    if (status === "unavailable") throw new Error("the gateway spend pipeline is not registered");
  }
}
