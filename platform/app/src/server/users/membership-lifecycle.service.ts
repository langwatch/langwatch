import type { PrismaClient } from "~/generated/prisma/client";
import {
  closeOpenLinksForMembership,
  type TransactionClient,
} from "~/server/users/close-open-links";
import { UserService } from "~/server/users/user.service";

/**
 * How the membership itself changes when a person is offboarded from one
 * organization. SCIM `active: false` disables the row; SCIM DELETE removes it.
 * Neither touches the person's grants — those are the grants ledger's, and the
 * caller revokes them through it before the membership change.
 */
export type MembershipChange = "disable" | "remove";

export interface MembershipDeactivationOutcome {
  /** Closing rows appended — one per login this person still held here. */
  closedLinks: number;
  /** True when this was the last active membership, so the account went off. */
  globallyDeactivated: boolean;
}

/**
 * Which organizations this person is still active in.
 *
 * Asked through the PERSON rather than as a bare `organizationUser` query on
 * purpose. `OrganizationUser` is registered in `ORG_SCOPED_MODELS`, and the
 * tenancy guard rejects any query on it that names no organization — which a
 * "count their memberships everywhere" question never can, since spanning
 * organizations is the entire point of the last-membership rule. Reading it as
 * a relation under one `User` row id keeps the query bounded to a single
 * person, which is the honest bound anyway, and passes the guard.
 */
const activeMembershipsOf = async ({
  tx,
  userId,
}: {
  tx: TransactionClient;
  userId: string;
}): Promise<Array<{ organizationId: string }>> => {
  const person = await tx.user.findUnique({
    where: { id: userId },
    select: {
      orgMemberships: {
        where: { disabledAt: null },
        select: { organizationId: true },
      },
    },
  });
  return person?.orgMemberships ?? [];
};

/**
 * Membership lifecycle for ONE organization (ADR-094 Decision 4).
 *
 * Directory-driven offboarding used to reach for the global account flag, so
 * one organization's IdP could switch a person off inside every other
 * organization they belong to (#6976). Deactivation is a membership event
 * here: the membership row changes, every provider login the person still
 * held in THIS organization gets a closing link row, and only when their last
 * active membership goes does the global account follow.
 *
 * The closing rows are written in the SAME transaction as the membership
 * change. Append-after-commit is banned by the ADR: the SCIM delete path used
 * to commit the removal first, and a crash in the gap lost the closing row
 * forever because the IdP's retry answers 404 before reaching it. The
 * reconciliation sweep catches anything that still slips through — it is the
 * backstop, never the mechanism.
 *
 * Reactivation restores the membership and never restores links: an admin
 * relinks, because silently re-attaching money to a person we un-attached it
 * from is the guess this ADR exists to refuse.
 *
 * What this transaction owns is membership state and closing link rows, and
 * nothing else. Grant revocation belongs to the grants ledger (ADR-092
 * decision 18) and is eventually consistent by design — the caller appends
 * the offboard fact before calling in here.
 */
export class MembershipLifecycleService {
  private readonly userService: UserService;

  constructor(private readonly prisma: PrismaClient) {
    this.userService = UserService.create(prisma);
  }

  static create(prisma: PrismaClient): MembershipLifecycleService {
    return new MembershipLifecycleService(prisma);
  }

  /**
   * The one implementation every org-scoped deactivation entry point calls.
   *
   * `actorUserId` is the admin behind the change when there is one; directory
   * traffic has no session, so it is null and the closing row says only that
   * offboarding wrote it.
   */
  async onMembershipDeactivated({
    organizationId,
    userId,
    actorUserId = null,
    membershipChange = "disable",
    now = new Date(),
  }: {
    organizationId: string;
    userId: string;
    actorUserId?: string | null;
    membershipChange?: MembershipChange;
    now?: Date;
  }): Promise<MembershipDeactivationOutcome> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (membershipChange === "remove") {
        // deleteMany, not delete: a redelivered SCIM DELETE must not blow
        // up on a row that is already gone.
        await tx.organizationUser.deleteMany({
          where: { userId, organizationId },
        });
        // Grants are NOT removed here. The grants ledger is their only writer
        // (ADR-092 decision 18), and the caller offboards through it before
        // calling this — `offboardMember`'s fold sweeps every grant the
        // principal holds, including ones this transaction could not see.
        // Deleting them here as well would race that sweep and put a second
        // writer on the projection.
      } else {
        // Scoped to still-open memberships so a repeat disable keeps the
        // original timestamp instead of sliding it forward.
        await tx.organizationUser.updateMany({
          where: { userId, organizationId, disabledAt: null },
          data: { disabledAt: now },
        });
      }

      const closedLinks = await closeOpenLinksForMembership({
        tx,
        organizationId,
        userId,
        actorUserId,
        now,
      });

      // The last active membership out turns the account off — and only
      // then. That is the whole of #6976: one organization's directory must
      // not reach into the 207 people who belong to more than one.
      const activeMembershipsLeft = (await activeMembershipsOf({ tx, userId }))
        .length;
      const globallyDeactivated =
        activeMembershipsLeft === 0 &&
        (await this.markAccountDeactivated({ tx, userId, now }));

      return { closedLinks, globallyDeactivated };
    });

    if (outcome.globallyDeactivated) {
      await this.userService.revokeAllAccess({ userId });
    }
    return outcome;
  }

  /**
   * A deactivation of the whole ACCOUNT — the person themself, or a
   * platform administrator, switching the person off everywhere rather than
   * one directory withdrawing one membership.
   *
   * It ends every membership in substance, so every organization the person
   * is still active in gets its closing rows, in the same transaction as the
   * flag write for the same reason the per-organization path does. The
   * membership rows themselves stay intact: the global flag is what denies
   * access, and leaving the rows alone is what lets a later reactivate put
   * the person back where they were.
   */
  async onUserDeactivated({
    userId,
    actorUserId = null,
    now = new Date(),
  }: {
    userId: string;
    actorUserId?: string | null;
    now?: Date;
  }): Promise<MembershipDeactivationOutcome> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const memberships = await activeMembershipsOf({ tx, userId });

      let closedLinks = 0;
      for (const { organizationId } of memberships) {
        closedLinks += await closeOpenLinksForMembership({
          tx,
          organizationId,
          userId,
          actorUserId,
          now,
        });
      }

      return {
        closedLinks,
        globallyDeactivated: await this.markAccountDeactivated({
          tx,
          userId,
          now,
        }),
      };
    });

    if (outcome.globallyDeactivated) {
      await this.userService.revokeAllAccess({ userId });
    }
    return outcome;
  }

  /**
   * Set the global flag unless it is already set, and say whether this call
   * is the one that set it — so a repeated deactivate does not re-run the
   * revocations or move the timestamp.
   */
  private async markAccountDeactivated({
    tx,
    userId,
    now,
  }: {
    tx: TransactionClient;
    userId: string;
    now: Date;
  }): Promise<boolean> {
    const { count } = await tx.user.updateMany({
      where: { id: userId, deactivatedAt: null },
      data: { deactivatedAt: now },
    });
    return count > 0;
  }

  /**
   * Re-provisioning restores the membership in THIS organization only, and
   * lifts the global account flag only if it was set. Other organizations'
   * memberships are never touched — the reverse of #6976 is the same bug.
   * Links stay closed by design (ADR-094 Decision 4).
   */
  async onMembershipReactivated({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationUser.updateMany({
        where: { userId, organizationId, disabledAt: { not: null } },
        data: { disabledAt: null },
      });
      // Scoped to a flag that is actually set, so re-provisioning somebody
      // who was never deactivated writes nothing.
      await tx.user.updateMany({
        where: { id: userId, deactivatedAt: { not: null } },
        data: { deactivatedAt: null },
      });
    });
  }
}
