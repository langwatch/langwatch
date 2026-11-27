import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { SeatChangeBusyError, SeatPaymentWaitingError } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { PendingSeatRoleChangeRepository } from "../repositories/pending-seat-role-change.repository.ts";

const logger = createLogger("langwatch:organization:seatRoleChangeClaim");

/** How often a role write renews its claim, well inside the claim period. */
const CLAIM_RENEW_MS = 30_000;
/** How often settling a change a newer role write replaced is tried. */
const SUPERSEDE_ATTEMPTS = 3;
/** How long a member's second seat purchase waits for the first before it is refused busy. */
const PURCHASE_WAIT_MS = 30_000;
/** How often a waiting purchase asks again for the member's purchase claim. */
const PURCHASE_POLL_MS = 100;
/** Why a change a newer role write replaced was not applied. */
export const REPLACED = "a later role change for this member replaced it";

/** The member's waiting change held under this token, or none waiting. */
export type WaitingClaim = { status: "none" } | { status: "held"; id: string; token: string };

type Dependencies = { pending: PendingSeatRoleChangeRepository; newId: () => string };

/**
 * The claim on a role change waiting on its seat payment (role-change-seat.feature): one role
 * write holds it at a time, renews it while it runs, and settles a change a newer write replaced.
 */
export class SeatRoleChangeClaimService {
  static create(dependencies: Dependencies): SeatRoleChangeClaimService {
    return new SeatRoleChangeClaimService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /**
   * Settles the change a newer role write replaced. Retried; when every try fails the change
   * stays waiting, and its paid write is refused later because the role version moved.
   */
  async supersede({ organizationId, id }: { organizationId: string; id: string }): Promise<void> {
    for (let attempt = 1; attempt <= SUPERSEDE_ATTEMPTS; attempt++) {
      try {
        await this.dependencies.pending.settle({
          organizationId,
          id,
          status: "superseded",
          reason: REPLACED,
        });
        return;
      } catch (error) {
        logger.error(
          { organizationId, changeId: id, error, attempt },
          "replaced change not settled",
        );
      }
    }
  }

  /**
   * Runs one seat purchase per member at a time: a double click or a second tab waits for the
   * first, then finds the member already holding the seat it bought, so no second seat is bought.
   */
  async onePurchasePerMember<T>(
    member: { organizationId: string; userId: string },
    work: () => Promise<T>,
  ): Promise<T> {
    const claim = {
      organizationId: member.organizationId,
      id: `purchase:${member.userId}`,
      token: generate("seatpurchaseclaim").toString(),
    };
    const deadline = nowInstant().epochMilliseconds + PURCHASE_WAIT_MS;
    while (!(await this.dependencies.pending.claim(claim))) {
      if (nowInstant().epochMilliseconds >= deadline) throw new SeatChangeBusyError();
      await new Promise((resolve) => setTimeout(resolve, PURCHASE_POLL_MS));
    }
    try {
      return await this.underClaim(claim, work);
    } finally {
      await this.release(claim);
    }
  }

  /** Frees a claim; a failed release is logged, the claim lapses on its own. */
  async release(claim: { organizationId: string; id: string; token: string }): Promise<void> {
    await this.dependencies.pending.release(claim).catch((error: unknown) => {
      logger.warn(
        { organizationId: claim.organizationId, changeId: claim.id, error },
        "claim not released",
      );
    });
  }

  /** Claims the member's waiting change, if any; refuses while its paid write is under way. */
  async claimWaiting(member: { organizationId: string; userId: string }): Promise<WaitingClaim> {
    const [latest] = await this.dependencies.pending.findLatestForMember(member);
    if (latest?.status !== "waiting") return { status: "none" };
    const held = { id: latest.id, token: this.dependencies.newId() };
    if (
      !(await this.dependencies.pending.claim({ organizationId: member.organizationId, ...held }))
    ) {
      throw new SeatPaymentWaitingError();
    }
    return { status: "held", ...held };
  }

  /**
   * Runs a role write while renewing the claim, so the claim lapses only when its holder is gone
   * or cannot reach the store, and no second applier writes beside a live one.
   */
  async underClaim<T>(
    claim: { organizationId: string; id: string; token: string },
    work: () => Promise<T>,
  ): Promise<T> {
    const renewal = setInterval(() => {
      this.dependencies.pending.renew(claim).catch((error: unknown) => {
        logger.warn(
          { organizationId: claim.organizationId, changeId: claim.id, error },
          "claim not renewed",
        );
      });
    }, CLAIM_RENEW_MS);
    try {
      return await work();
    } finally {
      clearInterval(renewal);
    }
  }
}
