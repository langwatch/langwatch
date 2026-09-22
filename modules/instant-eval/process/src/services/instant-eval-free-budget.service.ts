/**
 * What an organization without a paid plan may have of Instant Evals: the
 * gateway spend ledger, cached for a minute, counted beside the holds taken
 * for work the ledger has not learned about yet.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import {
  INSTANT_EVAL_REQUEST_TYPE,
  InstantEvalFreeBudgetExhaustedError,
} from "@langwatch/instant-eval-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { InstantEvalBudgetReservationsChannel } from "../channels/instant-eval-budget-reservations.channel.ts";
import {
  freeInstantEvalStanding,
  INSTANT_EVAL_FREE_BUDGET_USD,
  INSTANT_EVAL_RESERVATION_TTL_MS,
  instantEvalBudgetRoomNanoUsd,
  instantEvalCommittedUsd,
  isWithinInstantEvalBudget,
  paidInstantEvalStanding,
  type InstantEvalFreeBudgetStanding,
} from "../rules/instant-eval-budget.rules.ts";
import { NANO_USD_PER_USD } from "../rules/instant-eval-spend-outcome.rules.ts";

const CACHE_TTL_MS = 60_000;

/** The peers the budget is resolved through, each one operation wide. */
export interface InstantEvalBudgetPeers {
  /** The organization the project belongs to, or undefined when it has none. */
  findOrganizationId(input: { projectId: string }): Promise<string | undefined>;
  /** Every project of the organization, archived ones included: the ledger's
   *  tenant is the project the spend happened in, whatever became of it. */
  listProjectIds(input: { organizationId: string }): Promise<readonly string[]>;
  /** Whether the organization is on a plan without a subscription. */
  isFreePlan(input: { organizationId: string }): Promise<boolean>;
  /** The ledger read, in integer nano-USD. */
  sumSpendNanoUsdByRequestType(input: {
    tenantIds: readonly string[];
    requestType: string;
  }): Promise<number>;
}

interface CachedSpend {
  readonly nanoUsd: number;
  readonly expiresAt: number;
}

export class InstantEvalFreeBudgetService {
  readonly #spent = new Map<string, CachedSpend>();

  private constructor(
    private readonly peers: InstantEvalBudgetPeers,
    private readonly reservations: InstantEvalBudgetReservationsChannel,
    private readonly isBounded: boolean,
    private readonly now: () => Instant,
  ) {}

  /**
   * `isBounded` is the deployment's own decision: an installation that does
   * not bill Instant Evals bounds them by the row cap alone, and answers the
   * standing of anything the free budget does not reach.
   */
  static create({
    peers,
    reservations,
    isBounded = true,
    now,
  }: {
    peers: InstantEvalBudgetPeers;
    reservations: InstantEvalBudgetReservationsChannel;
    isBounded?: boolean;
    now?: () => Instant;
  }): InstantEvalFreeBudgetService {
    return new InstantEvalFreeBudgetService(peers, reservations, isBounded, now ?? nowInstant);
  }

  /** Where the project's organization stands against the budget. */
  async standing({ projectId }: { projectId: string }): Promise<InstantEvalFreeBudgetStanding> {
    const organizationId = await this.#boundOrganizationOf(projectId);
    if (organizationId === undefined) return paidInstantEvalStanding();

    return freeInstantEvalStanding({ spentNanoUsd: await this.#spentNanoUsd(organizationId) });
  }

  /**
   * Refuses when the organization is free and the budget is spent.
   * `inFlightUsd` is what the caller has judged since its own hold was taken,
   * and `reservationId` names that hold, which is therefore left out.
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
    const organizationId = await this.#boundOrganizationOf(projectId);
    if (organizationId === undefined) return;

    const committedUsd = instantEvalCommittedUsd({
      spentNanoUsd: await this.#spentNanoUsd(organizationId),
      heldNanoUsd: await this.reservations.heldNanoUsd({
        organizationId,
        ...(reservationId === undefined ? {} : { except: reservationId }),
      }),
      inFlightUsd,
    });
    if (isWithinInstantEvalBudget({ committedUsd })) return;

    throw new InstantEvalFreeBudgetExhaustedError({
      spentUsd: committedUsd,
      budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
    });
  }

  /**
   * Holds `priceUsd` under `reservationId` until {@link release}, or refuses
   * when it does not fit beside the spend and the other holds. Taken atomically
   * against them, so two runs accepted at once share the budget.
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
    const organizationId = await this.#boundOrganizationOf(projectId);
    if (organizationId === undefined) return;

    const spentNanoUsd = await this.#spentNanoUsd(organizationId);
    const outcome = await this.reservations.reserve({
      organizationId,
      reservationId,
      nanoUsd: Math.round(priceUsd * NANO_USD_PER_USD),
      limitNanoUsd: instantEvalBudgetRoomNanoUsd({ spentNanoUsd }),
      ttlMs: INSTANT_EVAL_RESERVATION_TTL_MS,
    });
    if (outcome.isReserved) return;

    throw new InstantEvalFreeBudgetExhaustedError({
      spentUsd: (spentNanoUsd + outcome.heldNanoUsd) / NANO_USD_PER_USD,
      budgetUsd: INSTANT_EVAL_FREE_BUDGET_USD,
    });
  }

  /**
   * Drops the hold once the spend it stood for has been recorded, and forgets
   * the cached ledger read so the next check sees the spend.
   */
  async release({
    projectId,
    reservationId,
  }: {
    projectId: string;
    reservationId: string;
  }): Promise<void> {
    if (!this.isBounded) return;

    const organizationId = await this.peers.findOrganizationId({ projectId });
    if (organizationId === undefined) return;

    // The cache goes first: a check that runs between the two steps then reads
    // the ledger, which already carries the spend the hold stood for, rather
    // than a cached total from before it beside a hold already gone.
    this.#spent.delete(organizationId);
    await this.reservations.release({ organizationId, reservationId });
  }

  /**
   * The project's organization when the free budget bounds it. A project with
   * no organization is treated as paid rather than as free at zero: the budget
   * bounds an organization that has not paid, and there is none here.
   */
  async #boundOrganizationOf(projectId: string): Promise<string | undefined> {
    if (!this.isBounded) return undefined;

    const organizationId = await this.peers.findOrganizationId({ projectId });
    if (organizationId === undefined) return undefined;

    return (await this.peers.isFreePlan({ organizationId })) ? organizationId : undefined;
  }

  async #spentNanoUsd(organizationId: string): Promise<number> {
    const nowMs = this.now().epochMilliseconds;
    const cached = this.#spent.get(organizationId);
    if (cached && cached.expiresAt > nowMs) return cached.nanoUsd;

    const nanoUsd = await this.peers.sumSpendNanoUsdByRequestType({
      tenantIds: await this.peers.listProjectIds({ organizationId }),
      requestType: INSTANT_EVAL_REQUEST_TYPE,
    });
    this.#spent.set(organizationId, { nanoUsd, expiresAt: nowMs + CACHE_TTL_MS });

    return nanoUsd;
  }
}
