/**
 * Writes the ledger row for one PII redaction model call from data-privacy's priced fact
 * (ADR-201), looking up the team through gateway's own project dependency.
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract";
import type { GatewayPricedSpend, GatewayPricedSpendResult } from "@langwatch/gateway-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import { gatewayPricedSpendOfPiiRedaction } from "../../../rules/gateway-pii-redaction-spend.rules.ts";

const defaultLogger: Logger = createLogger("langwatch:gateway:pii-redaction-spend");

type GatewayPiiRedactionSpendDeps = Readonly<{
  projects: Pick<ProjectApi, "findWithTeam">;
  /** The spend spine's priced append, keyed by request id, so a repeat is one row. */
  recordPricedSpend: (input: GatewayPricedSpend) => Promise<GatewayPricedSpendResult>;
  logger?: Pick<Logger, "error">;
}>;

export class GatewayPiiRedactionSpendService {
  private readonly logger: Pick<Logger, "error">;

  private constructor(private readonly deps: GatewayPiiRedactionSpendDeps) {
    this.logger = deps.logger ?? defaultLogger;
  }

  static create(deps: GatewayPiiRedactionSpendDeps): GatewayPiiRedactionSpendService {
    return new GatewayPiiRedactionSpendService(deps);
  }

  async recordPiiRedactionSpend({
    fact,
  }: {
    fact: PiiRedactionSpendPricedEventData;
  }): Promise<void> {
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
        "PII redaction spend not written to the ledger: the project has no team",
      );
      return;
    }
    const { status } = await this.deps.recordPricedSpend(
      gatewayPricedSpendOfPiiRedaction({ fact, teamId: project.team.id }),
    );
    // Throw so the fact is delivered again: a dropped row is usage given away.
    if (status === "unavailable") throw new Error("the gateway spend pipeline is not registered");
  }
}
