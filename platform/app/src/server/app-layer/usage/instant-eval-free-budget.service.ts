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
 * The ledger learns about a run when the run finishes, so a check that read
 * it alone would admit any number of runs while none had landed a row. A run
 * therefore reserves its estimated price when it is accepted, a judged query
 * reserves its ceiling before it judges, and the check counts what is held
 * beside what was spent until the spend lands and the hold is released.
 *
 * @see ./instant-eval-budget-reservations.ts
 * @see ../instant-evals/spend/instant-eval-spend.outcome.ts
 * @see ../../../../../specs/instant-evals/instant-eval-billing.feature
 */

import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { TtlCache } from "../../utils/ttlCache";
import { InstantEvalFreeBudgetExhaustedError } from "../instant-evals/errors";
import { INSTANT_EVAL_REQUEST_TYPE } from "../instant-evals/spend/request-type";
import type { InstantEvalBudgetReservations } from "./instant-eval-budget-reservations";

/** What an organization without a paid plan may spend on Instant Evals, in USD. */
export const INSTANT_EVAL_FREE_BUDGET_USD = 1;

const INSTANT_EVAL_FREE_BUDGET_NANO_USD =
  INSTANT_EVAL_FREE_BUDGET_USD * NANO_USD_PER_USD;

const CACHE_TTL_MS = 60_000;

/**
 * How long a reservation outlives its owner. Long enough for any run to
 * finish and land its spend; short enough that a run whose process died
 * without releasing does not hold the budget for good.
 */
export const INSTANT_EVAL_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

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
  /** Where accepted work that has not reached the ledger yet is held. */
  readonly reservations: InstantEvalBudgetReservations;
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

  /**
   * Refuses when the organization is free and the budget is spent.
   *
   * `inFlightUsd` is spend that has happened but has not reached the ledger,
   * which for a run is everything it judged before its current page: a run
   * records its spend once, at the end, so a check that read the ledger alone
   * would let one accepted run judge every row it was given no matter how far
   * past the budget that took it. Counting what the caller is holding is what
   * bounds a single run to one page of overshoot.
   *
   * The other reservations of the organization count too, so a run under way
   * is stopped by the runs accepted beside it. `reservationId` names the
   * caller's own hold, which is left out: its own spend is `inFlightUsd`.
   */
  async assertWithinBudget({
    projectId,
    inFlightUsd = 0,
    reservationId,
  }: {
    projectId: string;
    inFlightUsd?: number;
    reservationId?: string;
  }): Promise<void> {
    const organizationId = await this.freeOrganizationOf(projectId);
    if (!organizationId) return;
    const spentNanoUsd = await this.spentNanoUsd(organizationId);
    const heldNanoUsd = await this.deps.reservations.heldNanoUsd({
      organizationId,
      ...(reservationId === undefined ? {} : { except: reservationId }),
    });
    const committedUsd = (spentNanoUsd + heldNanoUsd) / NANO_USD_PER_USD;
    if (INSTANT_EVAL_FREE_BUDGET_USD > committedUsd + inFlightUsd) return;
    throw new InstantEvalFreeBudgetExhaustedError({
      spentUsd: committedUsd + inFlightUsd,
      budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
    });
  }

  /**
   * Holds `priceUsd` under `reservationId` until {@link release}, or refuses
   * when it does not fit beside the spend and the other reservations.
   *
   * The hold is taken atomically against the others, which is what makes two
   * runs accepted in the same instant share the budget rather than each
   * being admitted against a ledger that knows about neither.
   */
  async reserve({
    projectId,
    reservationId,
    priceUsd,
  }: {
    projectId: string;
    reservationId: string;
    priceUsd: number;
  }): Promise<void> {
    const organizationId = await this.freeOrganizationOf(projectId);
    if (!organizationId) return;
    const spentNanoUsd = await this.spentNanoUsd(organizationId);
    const outcome = await this.deps.reservations.reserve({
      organizationId,
      reservationId,
      nanoUsd: Math.round(priceUsd * NANO_USD_PER_USD),
      limitNanoUsd: Math.max(
        0,
        INSTANT_EVAL_FREE_BUDGET_NANO_USD - spentNanoUsd,
      ),
      ttlMs: INSTANT_EVAL_RESERVATION_TTL_MS,
    });
    if (outcome.isReserved) return;
    throw new InstantEvalFreeBudgetExhaustedError({
      spentUsd: (spentNanoUsd + outcome.heldNanoUsd) / NANO_USD_PER_USD,
      budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
    });
  }

  /**
   * Drops the hold once the spend it stood for has been recorded, and
   * forgets the cached ledger read so the next check sees the spend.
   */
  async release({
    projectId,
    reservationId,
  }: {
    projectId: string;
    reservationId: string;
  }): Promise<void> {
    const organizationId = await this.deps.organizationOf(projectId);
    if (!organizationId) return;
    await this.deps.reservations.release({ organizationId, reservationId });
    await this.spentCache.delete(organizationId);
  }

  /** The project's organization when the free budget bounds it, else null. */
  private async freeOrganizationOf(projectId: string): Promise<string | null> {
    const organizationId = await this.deps.organizationOf(projectId);
    if (!organizationId) return null;
    return (await this.deps.isFreePlan(organizationId)) ? organizationId : null;
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
export const UNBOUNDED_INSTANT_EVAL_BUDGET: InstantEvalFreeBudget = {
  standing: async () => paidStanding(),
  assertWithinBudget: async () => undefined,
  reserve: async () => undefined,
  release: async () => undefined,
};

/** What the run service and the query service depend on. */
export type InstantEvalFreeBudget = Pick<
  InstantEvalFreeBudgetService,
  "standing" | "assertWithinBudget" | "reserve" | "release"
>;
