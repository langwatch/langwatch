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

const logger = createLogger("langwatch:organization:memberRoleSeatPurchase");

/** What the admin reads when the role write fails for a cause we did not name. */
const UNKNOWN_REFUSAL = "something went wrong on our side";

type RoleChange = (
  input: Readonly<{
    organizationId: string;
    userId: string;
    role: OrganizationUserRole;
    planUser?: { id: string; name?: string | null; email?: string | null };
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
class SeatRoleChangeNotAppliedYetError extends Error {
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

  private constructor(private readonly dependencies: Dependencies) {}

  async changeWithSeat(
    input: ChangeInput,
    by: OrganizationCaller,
  ): Promise<MemberRoleWithSeatResult> {
    const { organizationId, userId, role } = input;
    const change = { organizationId, userId, role, planUser: by };
    try {
      const { teamsLeftWithoutAdmin } = await this.dependencies.changeMemberRole(change, by);
      await this.supersedeWaiting({ organizationId, userId });
      return { status: "changed", seatAdded: false, teamsLeftWithoutAdmin };
    } catch (error) {
      const refusal = readSeatRefusal(error);
      if (refusal.kind !== "seat-limit" || refusal.limit.limitType !== "members") throw error;
    }

    const [waiting] = await this.dependencies.pending.findWaitingForOrganization({
      organizationId,
    });
    if (waiting) return this.resumeWaiting({ waiting, input });

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
    const [sharing] = await this.dependencies.pending.findByPayment({ payment: purchase.payment });
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
    });
    if (!saved) {
      // A concurrent change saved this payment first: that one is the change it pays for.
      const [winner] = await this.dependencies.pending.findByPayment({ payment: purchase.payment });
      if (!winner) throw new SeatPaymentWaitingError();
      return this.resumeWaiting({ waiting: winner, input });
    }
    return { status: "payment_required", changeId, url: purchase.url };
  }

  /** The same change asked again reopens its payment page; any other one waits its turn. */
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
      await this.recordBlocked(input, by);
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
    await this.dependencies.billing.recordBlockedSeatChange({
      organizationId,
      userId: by.id,
      attempt: { kind: "role_change", memberName, role: roleLabel(role) },
      seats: 1,
    });
    return { recorded: true };
  }

  async complete({
    organizationId,
    changeId,
  }: {
    organizationId: string;
    changeId: string;
  }): Promise<SeatRoleChangeOutcome> {
    const [record] = await this.dependencies.pending.findById({ id: changeId });
    if (!record || record.organizationId !== organizationId) {
      throw new NotFoundError("not_found", { resource: "Role change", id: changeId });
    }
    return this.apply({ record, paid: false });
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
    const [record] = await this.dependencies.pending.findByPayment({ payment });
    if (!record || record.organizationId !== organizationId) return;
    const { status } = await this.apply({ record, paid: payment.kind === "checkout" });
    if (status === "waiting") throw new SeatRoleChangeNotAppliedYetError(record.id);
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
      const [record] = await this.dependencies.pending.findByPayment({ payment });
      if (record?.organizationId !== organizationId || record.status !== "waiting") continue;
      await this.dependencies.pending.settle({ id: record.id, status: "failed" });
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

  /** A newer role write wins: the member's change still waiting on a payment never applies. */
  private async supersedeWaiting(member: { organizationId: string; userId: string }) {
    const [latest] = await this.dependencies.pending.findLatestForMember(member);
    if (latest?.status !== "waiting") return;
    await this.dependencies.pending.settle({
      id: latest.id,
      status: "seat_only",
      reason: "a later role change for this member replaced it",
    });
  }

  /** Settled changes answer as they are; a paid one is written by the one applier claiming it. */
  private async apply({
    record,
    paid,
  }: {
    record: PendingSeatRoleChangeRecord;
    paid: boolean;
  }): Promise<SeatRoleChangeOutcome> {
    if (record.status !== "waiting") return outcomeOf(record);
    const { organizationId, id } = record;
    if (!paid) {
      const { status } = await this.dependencies.billing.settleSeatPayment({
        organizationId,
        payment: record.payment,
      });
      if (status === "open") return { status: "waiting", reason: null };
      if (status === "failed") {
        await this.dependencies.pending.settle({ id, status: "failed" });
        return { status: "failed", reason: null };
      }
    }

    const token = this.dependencies.newId();
    if (!(await this.dependencies.pending.claim({ id, token }))) {
      return { status: "waiting", reason: null };
    }
    try {
      const [current] = await this.dependencies.pending.findById({ id });
      if (current && current.status !== "waiting") return outcomeOf(current);
      return await this.writeRole({ record, token });
    } finally {
      await this.dependencies.pending.release({ id, token });
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
    const settle = async (status: Exclude<SeatRoleChangeStatus, "waiting">, reason?: string) => {
      await this.dependencies.pending.settle({ id, status, ...(reason ? { reason } : {}) });
      return { status, reason: reason ?? null };
    };
    if (!(await this.dependencies.canManage({ organizationId, userId: by.id }))) {
      return settle("seat_only", "the admin who asked can no longer change roles");
    }
    // A claim that expired during the checks has passed to another applier, which writes instead.
    if (!(await this.dependencies.pending.holds({ id, token }))) {
      return { status: "waiting", reason: null };
    }
    try {
      await this.dependencies.changeMemberRole({ organizationId, userId, role, planUser: by }, by);
    } catch (error) {
      logger.warn({ organizationId, changeId: id, error }, "seat paid, then the role was refused");
      return settle("seat_only", refusalReason(error));
    }
    logger.info({ organizationId, changeId: id }, "role change applied after its seat was paid");
    return settle("applied");
  }
}

function outcomeOf(record: PendingSeatRoleChangeRecord): SeatRoleChangeOutcome {
  return { status: record.status, reason: record.reason ?? null };
}
