import type { BillingApi, SeatPurchase } from "@langwatch/enterprise-billing-contract";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  type MemberRoleWithSeatResult,
  type OrganizationCaller,
  type OrganizationUserRole,
  type PendingSeatRoleChange,
  type SeatRoleChangeOutcome,
  type SeatRoleChangeStatus,
  SeatPaymentWaitingError,
} from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import {
  type OrganizationMembershipRepository,
  RoleVersionMovedError,
} from "../repositories/organization-membership.repository.ts";
import type {
  PendingSeatRoleChangeRecord,
  PendingSeatRoleChangeRepository,
} from "../repositories/pending-seat-role-change.repository.ts";
import { readSeatRefusal } from "../rules/seat-limit-refusal.rules.ts";
import {
  roleLabel,
  type SeatPaymentRef,
  seatRoleChangeReturnPath,
} from "../rules/seat-role-change.rules.ts";
import { REPLACED, SeatRoleChangeClaimService } from "./seat-role-change-claim.service.ts";

const logger = createLogger("langwatch:organization:memberRoleSeatPurchase");

/** What the admin reads when the role write fails for a cause we did not name. */
const UNKNOWN_REFUSAL = "something went wrong on our side";

type RoleChange = (
  input: Readonly<{
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    planUser?: { id: string; name?: string | null; email?: string | null };
    expectedRoleVersion?: number;
    roleChangeId?: string;
  }>,
  by: OrganizationCaller,
) => Promise<{ teamsLeftWithoutAdmin: { id: string; name: string }[] }>;

type ChangeInput = Readonly<{
  organizationId: string;
  userId: string;
  role: OrganizationUserRole;
  quotedAt?: number;
}>;

type Dependencies = {
  changeMemberRole: RoleChange;
  /** The member's role version: every role write moves it, so a paid change sees a newer one. */
  memberships: Pick<OrganizationMembershipRepository, "getRoleVersion">;
  billing: Pick<BillingApi, "addFullSeat" | "settleSeatPayment" | "recordBlockedSeatChange">;
  /** The member's name as the members page shows it. */
  memberName: (input: { organizationId: string; userId: string }) => Promise<string>;
  /** Whether the admin who asked may still change roles when the paid change applies. */
  canManage: (input: { organizationId: string; userId: string }) => Promise<boolean>;
  pending: PendingSeatRoleChangeRepository;
  newId: () => string;
  baseUrl: string;
};

/** Thrown to the paid fact while its change cannot apply yet, so eventing delivers it again. */
export class SeatRoleChangeNotAppliedYetError extends Error {
  constructor(changeId: string) {
    super(`The role change ${changeId} waiting on a paid seat could not apply yet`);
    this.name = "SeatRoleChangeNotAppliedYetError";
  }
}

/** The refusal in words the admin can read; the seat stays either way. */
function refusalReason(error: unknown): string {
  return HandledError.isHandled(error) ? error.message : UNKNOWN_REFUSAL;
}

/**
 * A role change that needs one more full seat (specs/licensing/role-change-seat.feature): tried
 * first, so only the full seat limit leads to a charge. A change waiting on a payment applies
 * once, one waits per organization, and a paid seat whose role write fails stays bought.
 */
export class MemberRoleSeatPurchaseService {
  static create(dependencies: Dependencies): MemberRoleSeatPurchaseService {
    return new MemberRoleSeatPurchaseService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {
    this.claims = SeatRoleChangeClaimService.create(dependencies);
  }

  private readonly claims: SeatRoleChangeClaimService;

  async changeWithSeat(
    input: ChangeInput,
    by: OrganizationCaller,
  ): Promise<MemberRoleWithSeatResult> {
    const { organizationId, userId } = input;
    return this.claims.onePurchasePerMember({ organizationId, userId }, () =>
      this.changeWithSeatHeld(input, by),
    );
  }

  private async changeWithSeatHeld(
    input: ChangeInput,
    by: OrganizationCaller,
  ): Promise<MemberRoleWithSeatResult> {
    const { organizationId, userId, role } = input;
    const change = { organizationId, userId, role, planUser: by };
    const direct = await this.changeDirectly({ input, by });
    if (direct) return direct;

    const [waiting] = await this.dependencies.pending.findWaitingForOrganization({
      organizationId,
    });
    if (waiting) return this.resumeWaiting({ waiting, input });

    // Read before the seat is bought: any role write after it replaces this change.
    const roleVersion = await this.dependencies.memberships.getRoleVersion({
      organizationId,
      userId,
    });
    const purchase = await this.buySeat({ input, by });
    if (purchase.status === "added") {
      try {
        const { teamsLeftWithoutAdmin } = await this.dependencies.changeMemberRole(change, by);
        return { status: "changed", seatAdded: true, teamsLeftWithoutAdmin };
      } catch (error) {
        logger.warn({ organizationId, userId, error }, "seat bought, then the role was refused");
        return { status: "seat_only", reason: refusalReason(error) };
      }
    }

    // Billing answers the invoice Stripe already holds, so a second admin finds the first one's.
    const [sharing] = await this.dependencies.pending.findByPayment({
      organizationId,
      payment: purchase.payment,
    });
    if (sharing?.status === "waiting") return this.resumeWaiting({ waiting: sharing, input });

    const changeId = this.dependencies.newId();
    const saved = await this.dependencies.pending.save({
      id: changeId,
      organizationId,
      userId,
      role,
      requestedBy: { id: by.id, name: by.name ?? null, email: by.email ?? null },
      payment: purchase.payment,
      url: purchase.url,
      status: "waiting",
      reason: null,
      createdAt: nowInstant().epochMilliseconds,
      roleVersion,
    });
    if (!saved) {
      // A concurrent change saved this payment first: that one is the change it pays for.
      const [winner] = await this.dependencies.pending.findByPayment({
        organizationId,
        payment: purchase.payment,
      });
      if (!winner) throw new SeatPaymentWaitingError();
      return this.resumeWaiting({ waiting: winner, input });
    }
    return { status: "payment_required", changeId, url: purchase.url };
  }

  /**
   * The role written at once while a full seat is free; undefined when the seat limit refused it.
   * The member's change waiting on a payment is held meanwhile, so its paid write cannot land
   * after this newer one, and is then replaced by it.
   */
  private async changeDirectly({
    input,
    by,
  }: {
    input: ChangeInput;
    by: OrganizationCaller;
  }): Promise<MemberRoleWithSeatResult | undefined> {
    const { organizationId, userId, role } = input;
    const waiting = await this.claims.claimWaiting({ organizationId, userId });
    const held = waiting.status === "held" ? { id: waiting.id, token: waiting.token } : undefined;
    const write = () =>
      this.dependencies.changeMemberRole({ organizationId, userId, role, planUser: by }, by);
    try {
      const { teamsLeftWithoutAdmin } = held
        ? await this.claims.underClaim({ organizationId, ...held }, write)
        : await write();
      if (held) await this.claims.supersede({ organizationId, id: held.id });
      return { status: "changed", seatAdded: false, teamsLeftWithoutAdmin };
    } catch (error) {
      const refusal = readSeatRefusal(error);
      if (refusal.kind !== "seat-limit" || refusal.limit.limitType !== "members") throw error;
      return undefined;
    } finally {
      if (held) await this.claims.release({ organizationId, ...held });
    }
  }

  /**
   * The same change asked again reopens its payment page, or answers how it settled; any other
   * one waits its turn.
   */
  private resumeWaiting({
    waiting,
    input,
  }: {
    waiting: PendingSeatRoleChangeRecord;
    input: ChangeInput;
  }): MemberRoleWithSeatResult {
    if (waiting.userId !== input.userId || waiting.role !== input.role) {
      throw new SeatPaymentWaitingError();
    }
    if (waiting.status === "applied") {
      return { status: "changed", seatAdded: true, teamsLeftWithoutAdmin: [] };
    }
    if (waiting.status === "seat_only") {
      return { status: "seat_only", reason: waiting.reason ?? UNKNOWN_REFUSAL };
    }
    if (waiting.status !== "waiting") throw new SeatPaymentWaitingError();
    return { status: "payment_required", changeId: waiting.id, url: waiting.url };
  }

  /** Stuck billing keeps the attempt, so the admin is told once billing works again. */
  private async buySeat({
    input,
    by,
  }: {
    input: ChangeInput;
    by: OrganizationCaller;
  }): Promise<SeatPurchase> {
    const { organizationId, userId } = input;
    try {
      return await this.dependencies.billing.addFullSeat({
        organizationId,
        ...(input.quotedAt === undefined ? {} : { quotedAt: input.quotedAt }),
        baseUrl: this.dependencies.baseUrl,
        successPath: seatRoleChangeReturnPath(userId),
        customerEmail: by.email ?? null,
      });
    } catch (error) {
      if (!HandledError.isHandled(error) || error.code !== "subscription_ambiguous") throw error;
      await this.recordBlocked(input, by).catch((recordError: unknown) => {
        logger.error(
          { organizationId, userId, error: recordError },
          "refused seat change not kept",
        );
      });
      throw error;
    }
  }

  /** Keeps a change refused for two live subscriptions, so its admin hears once billing works. */
  async recordBlocked(
    input: { organizationId: string; userId: string; role: OrganizationUserRole },
    by: OrganizationCaller,
  ): Promise<{ recorded: boolean }> {
    const { organizationId, userId, role } = input;
    const memberName = await this.dependencies.memberName({ organizationId, userId });
    return this.dependencies.billing.recordBlockedSeatChange({
      organizationId,
      userId: by.id,
      attempt: { kind: "role_change", memberName, role: roleLabel(role) },
      seats: 1,
    });
  }

  async complete({
    organizationId,
    changeId,
  }: {
    organizationId: string;
    changeId: string;
  }): Promise<SeatRoleChangeOutcome> {
    const [record] = await this.dependencies.pending.findById({ organizationId, id: changeId });
    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundError("not_found", { resource: "Role change", id: changeId });
    }
    const outcome = await this.apply({ record, paid: false });
    if (!outcome) throw new NotFoundError("not_found", { resource: "Role change", id: changeId });
    return outcome;
  }

  /**
   * Billing's paid fact for a payment: the change waiting on it applies, if there is one. The
   * fact itself proves a seat checkout was paid. Thrown while it cannot apply, so it comes again.
   */
  async paymentPaid({
    organizationId,
    payment,
  }: {
    organizationId: string;
    payment: SeatPaymentRef;
  }): Promise<void> {
    const [record] = await this.dependencies.pending.findByPayment({ organizationId, payment });
    if (!record) return;
    const outcome = await this.apply({ record, paid: payment.kind === "checkout" });
    if (outcome?.status === "waiting") throw new SeatRoleChangeNotAppliedYetError(record.id);
  }

  /** Billing's fact that seat checkouts were left unpaid and cancelled: their changes failed. */
  async paymentsAbandoned({
    organizationId,
    subscriptionIds,
  }: {
    organizationId: string;
    subscriptionIds: readonly string[];
  }): Promise<void> {
    for (const subscriptionId of subscriptionIds) {
      const payment: SeatPaymentRef = { kind: "checkout", subscriptionId };
      const [record] = await this.dependencies.pending.findByPayment({ organizationId, payment });
      if (record?.status !== "waiting") continue;
      await this.dependencies.pending.settle({ organizationId, id: record.id, status: "failed" });
    }
  }

  async pendingFor({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<PendingSeatRoleChange> {
    const [record] = await this.dependencies.pending.findLatestForMember({
      organizationId,
      userId,
    });
    if (!record) return null;
    return {
      changeId: record.id,
      role: record.role,
      url: record.url,
      status: record.status,
      reason: record.reason ?? null,
    };
  }

  /** Settled changes answer as they are; a paid one is written by the one applier claiming it. */
  private async apply({
    record,
    paid,
  }: {
    record: PendingSeatRoleChangeRecord;
    paid: boolean;
  }): Promise<SeatRoleChangeOutcome | null> {
    if (record.status !== "waiting") return outcomeOf(record);
    const { organizationId, id } = record;
    if (!paid) {
      const { status } = await this.dependencies.billing.settleSeatPayment({
        organizationId,
        payment: record.payment,
      });
      if (status === "open") return { status: "waiting", reason: null };
      if (status === "failed") {
        if (await this.dependencies.pending.settle({ organizationId, id, status: "failed" })) {
          return { status: "failed", reason: null };
        }
        // A change that expired meanwhile is gone, the same as one expiring under the claim.
        const [current] = await this.dependencies.pending.findById({ organizationId, id });
        return current ? outcomeOf(current) : null;
      }
    }

    const token = this.dependencies.newId();
    if (!(await this.dependencies.pending.claim({ organizationId, id, token }))) {
      return { status: "waiting", reason: null };
    }
    try {
      // A change that expired meanwhile is gone: its week is up, so nothing applies.
      const [current] = await this.dependencies.pending.findById({ organizationId, id });
      if (!current) return null;
      if (current.status !== "waiting") return outcomeOf(current);
      return await this.writeRole({ record: current, token });
    } finally {
      await this.claims.release({ organizationId, id, token });
    }
  }

  /** The seat is paid: the role is written, or the record says why it was not. */
  private async writeRole({
    record,
    token,
  }: {
    record: PendingSeatRoleChangeRecord;
    token: string;
  }): Promise<SeatRoleChangeOutcome> {
    const { organizationId, id, userId, role } = record;
    const by: OrganizationCaller = record.requestedBy;
    // A change settled meanwhile keeps its outcome: a stale applier never overwrites it.
    const settle = async (status: Exclude<SeatRoleChangeStatus, "waiting">, reason?: string) => {
      const ref = { organizationId, id };
      const why = reason ? { reason } : {};
      if (await this.dependencies.pending.settle({ ...ref, status, ...why })) {
        return { status, reason: reason ?? null };
      }
      const [current] = await this.dependencies.pending.findById(ref);
      return current ? outcomeOf(current) : { status, reason: reason ?? null };
    };
    // A claim that expired during the checks has passed to another applier, which acts instead.
    const stillHeld = () => this.dependencies.pending.renew({ organizationId, id, token });
    const waitingOutcome: SeatRoleChangeOutcome = { status: "waiting", reason: null };
    if (!(await this.dependencies.canManage({ organizationId, userId: by.id }))) {
      if (!(await stillHeld())) return waitingOutcome;
      return settle("seat_only", "the admin who asked can no longer change roles");
    }
    if (!(await stillHeld())) return waitingOutcome;
    try {
      await this.claims.underClaim({ organizationId, id, token }, () =>
        this.dependencies.changeMemberRole(
          {
            organizationId,
            userId,
            role,
            planUser: by,
            ...(record.roleVersion === undefined
              ? {}
              : { expectedRoleVersion: record.roleVersion, roleChangeId: id }),
          },
          by,
        ),
      );
    } catch (error) {
      const failed = failedWriteOutcome({ error, organizationId, id });
      return settle(failed.status, failed.reason);
    }
    logger.info({ organizationId, changeId: id }, "role change applied after its seat was paid");
    return settle("applied");
  }
}

/**
 * How a paid role write that threw settles: applied when the version moved by this change's own
 * earlier write, superseded by any later one, else seat only with the refusal.
 */
function failedWriteOutcome({
  error,
  organizationId,
  id,
}: {
  error: unknown;
  organizationId: string;
  id: string;
}): { status: "applied" | "superseded" | "seat_only"; reason?: string } {
  if (error instanceof RoleVersionMovedError && error.appliedChangeId === id) {
    logger.info({ organizationId, changeId: id }, "the paid change's role write had landed");
    return { status: "applied" };
  }
  if (error instanceof RoleVersionMovedError) {
    logger.info({ organizationId, changeId: id }, "a later role write replaced the paid change");
    return { status: "superseded", reason: REPLACED };
  }
  logger.warn({ organizationId, changeId: id, error }, "seat paid, then the role was refused");
  return { status: "seat_only", reason: refusalReason(error) };
}

function outcomeOf(record: PendingSeatRoleChangeRecord): SeatRoleChangeOutcome {
  return { status: record.status, reason: record.reason ?? null };
}
