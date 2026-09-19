/**
 * How much of Instant Evals an organization without a paid plan may have.
 *
 * One dollar, in total, across every project the organization owns. The
 * figure is read off the gateway spend ledger, where every judged query and
 * run is one confirmed row of request type `instant_eval`, and it is cached
 * per organization for a minute: a run that just finished is not going to be
 * refused a minute earlier than it would have been, and the ledger read is a
 * `FINAL` scan the create and estimate paths would otherwise repeat on every
 * request.
 *
 * The comparison is on integer nano-USD, the ledger's own unit, so 0.99 is
 * under the budget and 1.00 is at it, and there is no float in the way.
 *
 * A paid organization has no budget here at all: its judgements are metered
 * and billed, and the row cap is the only ceiling a run has.
 *
 * @see ../instant-evals/spend/instant-eval-spend.outcome.ts
 * @see ../../../../../specs/instant-evals/instant-eval-billing.feature
 */

import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { TtlCache } from "../../utils/ttlCache";
import { InstantEvalFreeBudgetExhaustedError } from "../instant-evals/errors";
import { INSTANT_EVAL_REQUEST_TYPE } from "../instant-evals/spend/request-type";

/** What an organization without a paid plan may spend on Instant Evals, in USD. */
export const INSTANT_EVAL_FREE_BUDGET_USD = 1;

const INSTANT_EVAL_FREE_BUDGET_NANO_USD =
  INSTANT_EVAL_FREE_BUDGET_USD * NANO_USD_PER_USD;

const CACHE_TTL_MS = 60_000;

/** Where the budget stands for one organization. */
export interface InstantEvalFreeBudgetStanding {
  /** Whether the organization is bounded by the free budget at all. */
  readonly isFree: boolean;
  readonly spentUsd: number;
  readonly budgetUsd: number;
  /** What is left, or null for a paid organization, which has no budget. */
  readonly remainingUsd: number | null;
}

export interface InstantEvalFreeBudgetServiceDependencies {
  /** The organization the project belongs to, or null when it has none. */
  readonly organizationOf: (projectId: string) => Promise<string | null>;
  /** Every project of the organization, archived ones included. */
  readonly projectsOf: (organizationId: string) => Promise<string[]>;
  /** Whether the organization is on a plan without a subscription. */
  readonly isFreePlan: (organizationId: string) => Promise<boolean>;
  /** The ledger read, in integer nano-USD. */
  readonly sumSpendNanoUsd: (args: {
    tenantIds: string[];
    requestType: string;
  }) => Promise<number>;
}

export class InstantEvalFreeBudgetService {
  private readonly spentCache = new TtlCache<number>(
    CACHE_TTL_MS,
    "ttlcache:instant-evals:free-budget:",
  );

  constructor(
    private readonly deps: InstantEvalFreeBudgetServiceDependencies,
  ) {}

  /** Where the project's organization stands against the budget. */
  async standing({
    projectId,
  }: {
    projectId: string;
  }): Promise<InstantEvalFreeBudgetStanding> {
    const organizationId = await this.deps.organizationOf(projectId);
    // A project with no organization has nothing to bill and nothing to cap.
    // It is treated as paid rather than as free at zero, because the free
    // budget exists to bound the platform's own spend for an organization
    // that has not paid, and there is no organization here to have paid.
    if (!organizationId) return paidStanding();
    if (!(await this.deps.isFreePlan(organizationId))) return paidStanding();

    const spentNanoUsd = await this.spentNanoUsd(organizationId);
    return {
      isFree: true,
      spentUsd: spentNanoUsd / NANO_USD_PER_USD,
      budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
      remainingUsd:
        Math.max(0, INSTANT_EVAL_FREE_BUDGET_NANO_USD - spentNanoUsd) /
        NANO_USD_PER_USD,
    };
  }

  /** Refuses when the organization is free and the budget is spent. */
  async assertWithinBudget({
    projectId,
  }: {
    projectId: string;
  }): Promise<void> {
    const standing = await this.standing({ projectId });
    if (!standing.isFree) return;
    if (standing.remainingUsd !== null && standing.remainingUsd > 0) return;
    throw new InstantEvalFreeBudgetExhaustedError({
      spentUsd: standing.spentUsd,
      budgetUsd: standing.budgetUsd,
    });
  }

  private async spentNanoUsd(organizationId: string): Promise<number> {
    const cached = await this.spentCache.get(organizationId);
    if (cached !== undefined) return cached;
    const tenantIds = await this.deps.projectsOf(organizationId);
    const spent = await this.deps.sumSpendNanoUsd({
      tenantIds,
      requestType: INSTANT_EVAL_REQUEST_TYPE,
    });
    await this.spentCache.set(organizationId, spent);
    return spent;
  }
}

function paidStanding(): InstantEvalFreeBudgetStanding {
  return {
    isFree: false,
    spentUsd: 0,
    budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
    remainingUsd: null,
  };
}

/** The budget everything not on SaaS has: none. */
export const UNBOUNDED_INSTANT_EVAL_BUDGET: Pick<
  InstantEvalFreeBudgetService,
  "standing" | "assertWithinBudget"
> = {
  standing: async () => paidStanding(),
  assertWithinBudget: async () => undefined,
};

/** The two reads the run service and the query service depend on. */
export type InstantEvalFreeBudget = Pick<
  InstantEvalFreeBudgetService,
  "standing" | "assertWithinBudget"
>;
