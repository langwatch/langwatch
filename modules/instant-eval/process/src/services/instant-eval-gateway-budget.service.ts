/**
 * The gateway budgets a customer set to block, asked before Instant Evals judge. The free
 * budget binds only an unpaid organization; these bind every plan, as they do gateway traffic.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import type {
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
} from "@langwatch/gateway-contract";
import { InstantEvalGatewayBudgetExceededError } from "@langwatch/instant-eval-contract";

/** The peers the check is resolved through, each one operation wide. */
interface InstantEvalGatewayBudgetPeers {
  /** The organization and team the project's spend is debited against, or undefined. */
  findSpendAttribution(input: {
    projectId: string;
  }): Promise<{ organizationId: string; teamId: string } | undefined>;
  /** The gateway's own preflight, the one its requests are refused by. */
  checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult>;
  /** Whether the project runs on its own decision model, whose cost is not ours (ADR-182). */
  isOwnDecisionModel(input: { projectId: string }): Promise<boolean>;
}

/** The scopes an Instant Eval answers to; it has no key, person or end user of its own. */
const INSTANT_EVAL_BUDGET_SCOPES: ReadonlySet<string> = new Set([
  "organization",
  "team",
  "project",
]);

/** A key id no key budget names, so only organization, team and project budgets apply. */
function instantEvalBudgetKeyId({ projectId }: { projectId: string }): string {
  return `_instant_eval_:project:${projectId}`;
}

export class InstantEvalGatewayBudgetService {
  private constructor(private readonly peers: InstantEvalGatewayBudgetPeers) {}

  static create({
    peers,
  }: {
    peers: InstantEvalGatewayBudgetPeers;
  }): InstantEvalGatewayBudgetService {
    return new InstantEvalGatewayBudgetService(peers);
  }

  /**
   * Refuses when a blocking budget is reached. `inFlightUsd` is what the caller has judged
   * that the ledger has not learned of yet, projected onto the budgets; a warn budget never
   * refuses.
   */
  async assertWithinGatewayBudget({
    projectId,
    inFlightUsd = 0,
  }: {
    projectId: string;
    inFlightUsd?: number;
  }): Promise<void> {
    if (await this.peers.isOwnDecisionModel({ projectId })) return;
    const attribution = await this.peers.findSpendAttribution({ projectId });
    if (!attribution) return;

    const result = await this.peers.checkBudget({
      organizationId: attribution.organizationId,
      teamId: attribution.teamId,
      projectId,
      virtualKeyId: instantEvalBudgetKeyId({ projectId }),
      principalUserId: null,
      providerKey: null,
      projectedCostUsd: inFlightUsd,
    });
    // A per-end-user budget on the project resolves too, but there is no end user to charge.
    const blocked = result.blockedBy.find((line) => INSTANT_EVAL_BUDGET_SCOPES.has(line.scope));
    if (result.decision !== "hard_block" || !blocked) return;

    throw new InstantEvalGatewayBudgetExceededError({
      budgetId: blocked.budgetId,
      scope: blocked.scope,
      window: blocked.window,
      limitUsd: Number(blocked.limitUsd),
      spentUsd: Number(blocked.spentUsd),
    });
  }
}
