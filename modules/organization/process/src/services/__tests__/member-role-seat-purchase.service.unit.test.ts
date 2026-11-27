/**
 * @vitest-environment node
 * A role change that needs one more full seat: validated, charged, then written exactly once.
 * @see ../../../../../../specs/licensing/role-change-seat.feature
 */
import {
  AmbiguousSubscriptionError,
  type BillingApi,
  type SeatPayment,
  type SeatPaymentStatus,
  type SeatPurchase,
  SeatBillingUnavailableError,
} from "@langwatch/enterprise-billing-contract";
import {
  CannotDisableLastAdminError,
  MemberSeatLimitReachedError,
  type OrganizationCaller,
  type OrganizationUserRole,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryPendingSeatRoleChangeRepository } from "../../repositories/memory/memory.pending-seat-role-change.repository.ts";
import { RoleVersionMovedError } from "../../repositories/organization-membership.repository.ts";
import { seatRoleChangeReturnPath } from "../../rules/seat-role-change.rules.ts";
import {
  MemberRoleSeatPurchaseService,
  SeatRoleChangeNotAppliedYetError,
} from "../member-role-seat-purchase.service.ts";

const ORG = "org_acme";
const SAM = "user_sam";
const ADMIN: OrganizationCaller = { id: "user_admin", name: "Ada", email: "ada@acme.example" };
const INVOICE: SeatPayment = { kind: "invoice", invoiceId: "in_seat", seats: 3 };
const KIM = "user_kim";
const MAKE_ADMIN = { organizationId: ORG, userId: SAM, role: "ADMIN" as OrganizationUserRole };

/** ACME's members and the full seats it pays for, as organization and billing hold them. */
function world({
  paid = 2,
  used = 2,
  now,
}: { paid?: number; used?: number; now?: () => number } = {}) {
  const state = {
    paid,
    used,
    roles: new Map<string, OrganizationUserRole>([[SAM, "EXTERNAL"]]),
    refuseOtherwise: false,
    /** Refuses only the role write that follows a bought seat. */
    refuseAfterSeat: false,
    adminCanManage: true,
    roleWrites: 0,
    /** Moved by every role write, as the membership row's role version is. */
    roleVersion: 0,
    purchase: { status: "added" } as SeatPurchase | Error,
    payments: new Map<string, SeatPaymentStatus>(),
  };
  const changeMemberRole = vi.fn(
    async (
      input: { userId: string; role: OrganizationUserRole; expectedRoleVersion?: number },
      _by: OrganizationCaller,
    ) => {
      const expected = input.expectedRoleVersion;
      if (expected !== undefined && expected !== state.roleVersion) {
        throw new RoleVersionMovedError(input.userId);
      }
      if (state.refuseOtherwise) throw new CannotDisableLastAdminError();
      if (state.refuseAfterSeat && state.used < state.paid) throw new CannotDisableLastAdminError();
      if (state.used >= state.paid) {
        throw new MemberSeatLimitReachedError({
          meta: { limitType: "members", current: state.used, max: state.paid },
        });
      }
      state.used += 1;
      state.roleWrites += 1;
      state.roleVersion += 1;
      state.roles.set(input.userId, input.role);
      return { teamsLeftWithoutAdmin: [] };
    },
  );
  const addFullSeat = vi.fn<BillingApi["addFullSeat"]>(async () => {
    if (state.purchase instanceof Error) throw state.purchase;
    if (state.purchase.status === "added") state.paid += 1;
    return state.purchase;
  });
  const settleSeatPayment = vi.fn<BillingApi["settleSeatPayment"]>(async ({ payment }) => {
    const key = payment.kind === "invoice" ? payment.invoiceId : payment.subscriptionId;
    return { status: state.payments.get(key) ?? "open" };
  });
  const recordBlockedSeatChange = vi.fn<BillingApi["recordBlockedSeatChange"]>(async () => ({
    recorded: true,
  }));
  const pending = MemoryPendingSeatRoleChangeRepository.create(now ? { now } : {});
  let ids = 0;
  const service = MemberRoleSeatPurchaseService.create({
    changeMemberRole,
    roleVersion: async () => state.roleVersion,
    billing: createApiFixture<BillingApi>(
      { addFullSeat, settleSeatPayment, recordBlockedSeatChange },
      "BillingApi",
    ),
    memberName: async () => "Sam",
    canManage: async () => state.adminCanManage,
    pending,
    newId: () => `change_${++ids}`,
    baseUrl: "https://app.example",
  });
  /** Stripe takes the payment: the held seat is added. */
  const pay = (key: string) => {
    state.payments.set(key, "paid");
    state.paid += 1;
  };
  return {
    state,
    service,
    changeMemberRole,
    addFullSeat,
    settleSeatPayment,
    recordBlockedSeatChange,
    pay,
    pending,
  };
}

describe("MemberRoleSeatPurchaseService", () => {
  describe("changeWithSeat()", () => {
    /** @scenario "A role change refused for another reason charges nothing" */
    it("answers another refusal by name and charges nothing", async () => {
      const { state, service, addFullSeat } = world();
      state.refuseOtherwise = true;

      await expect(service.changeWithSeat(MAKE_ADMIN, ADMIN)).rejects.toMatchObject({
        code: new CannotDisableLastAdminError().code,
      });
      expect(addFullSeat).not.toHaveBeenCalled();
    });

    /** @scenario "A free full seat is used without a charge" */
    it("uses a free full seat without buying one", async () => {
      const { state, service, addFullSeat } = world({ paid: 3, used: 2 });

      const result = await service.changeWithSeat(MAKE_ADMIN, ADMIN);

      expect(result).toEqual({ status: "changed", seatAdded: false, teamsLeftWithoutAdmin: [] });
      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(addFullSeat).not.toHaveBeenCalled();
    });

    /** @scenario "One click charges the seat and makes the member an Admin" */
    it("buys the seat, then changes the role", async () => {
      const { state, service, addFullSeat } = world();

      const result = await service.changeWithSeat(
        { ...MAKE_ADMIN, quotedAt: 1_700_000_000 },
        ADMIN,
      );

      expect(result).toEqual({ status: "changed", seatAdded: true, teamsLeftWithoutAdmin: [] });
      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(state.paid).toBe(3);
      expect(addFullSeat).toHaveBeenCalledWith({
        organizationId: ORG,
        quotedAt: 1_700_000_000,
        baseUrl: "https://app.example",
        successPath: seatRoleChangeReturnPath(SAM),
        customerEmail: ADMIN.email,
      });
    });

    /** @scenario "A charge needing the customer opens the seat invoice and changes nothing yet" */
    it("answers the payment page and keeps the role", async () => {
      const { state, service } = world();
      state.purchase = { status: "payment_required", payment: INVOICE, url: "https://pay.example" };

      const result = await service.changeWithSeat(MAKE_ADMIN, ADMIN);

      expect(result).toEqual({
        status: "payment_required",
        changeId: "change_1",
        url: "https://pay.example",
      });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
      expect(state.paid).toBe(2);
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toEqual({
        changeId: "change_1",
        role: "ADMIN",
        url: "https://pay.example",
        status: "waiting",
        reason: null,
      });
    });

    /** @scenario "A paid seat whose role change is refused keeps the seat and says why" */
    it("keeps a seat bought at once when the role is then refused, and says why", async () => {
      const { state, service } = world();
      state.refuseAfterSeat = true;

      const result = await service.changeWithSeat(MAKE_ADMIN, ADMIN);

      expect(result).toEqual({
        status: "seat_only",
        reason: new CannotDisableLastAdminError().message,
      });
      expect(state.paid).toBe(3);
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
    });

    /** @scenario "Seat billing off Cloud refuses the purchase by name" */
    it("passes seat_billing_unavailable through and changes nothing", async () => {
      const { state, service } = world();
      state.purchase = new SeatBillingUnavailableError();

      await expect(service.changeWithSeat(MAKE_ADMIN, ADMIN)).rejects.toMatchObject({
        code: "seat_billing_unavailable",
      });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
    });

    /** @scenario "Stuck billing refuses the seat by name" */
    it("passes subscription_ambiguous through and changes nothing", async () => {
      const { state, service, recordBlockedSeatChange } = world();
      state.purchase = new AmbiguousSubscriptionError(2);

      await expect(service.changeWithSeat(MAKE_ADMIN, ADMIN)).rejects.toMatchObject({
        code: "subscription_ambiguous",
      });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toBeNull();
      expect(recordBlockedSeatChange).toHaveBeenCalledWith({
        organizationId: ORG,
        userId: ADMIN.id,
        attempt: { kind: "role_change", memberName: "Sam", role: "Admin" },
        seats: 1,
      });
    });

    /** @scenario "Stuck billing still refuses by name when keeping the change fails" */
    it("refuses with subscription_ambiguous even when keeping the change throws", async () => {
      const { state, service, recordBlockedSeatChange } = world();
      state.purchase = new AmbiguousSubscriptionError(2);
      recordBlockedSeatChange.mockRejectedValueOnce(new Error("store unavailable"));

      await expect(service.changeWithSeat(MAKE_ADMIN, ADMIN)).rejects.toMatchObject({
        code: "subscription_ambiguous",
      });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
    });

    /** @scenario "A seat offer refused for two live subscriptions is kept for the admin" */
    it("keeps the refused role change for the admin when the offer read was refused", async () => {
      const { state, service, recordBlockedSeatChange, addFullSeat } = world();

      expect(await service.recordBlocked(MAKE_ADMIN, ADMIN)).toEqual({ recorded: true });
      expect(recordBlockedSeatChange).toHaveBeenCalledWith({
        organizationId: ORG,
        userId: ADMIN.id,
        attempt: { kind: "role_change", memberName: "Sam", role: "Admin" },
        seats: 1,
      });
      expect(addFullSeat).not.toHaveBeenCalled();
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
    });

    /** @scenario "Keeping a refused role change answers whether billing kept it" */
    it("answers not recorded when billing keeps nothing", async () => {
      const { service, recordBlockedSeatChange } = world();
      recordBlockedSeatChange.mockResolvedValueOnce({ recorded: false });

      expect(await service.recordBlocked(MAKE_ADMIN, ADMIN)).toEqual({ recorded: false });
    });
  });

  describe("given a change waiting on its payment", () => {
    const waiting = async (payment: SeatPayment = INVOICE, now?: () => number) => {
      const w = world(now ? { now } : {});
      w.state.purchase = { status: "payment_required", payment, url: "https://pay.example" };
      await w.service.changeWithSeat(MAKE_ADMIN, ADMIN);
      return w;
    };

    /** @scenario "The paid invoice applies the change, then the return changes nothing" */
    it("applies on the paid fact, and the return finds it applied", async () => {
      const { state, service, pay } = await waiting();
      pay("in_seat");

      await service.paymentPaid({ organizationId: ORG, payment: INVOICE });
      const back = await service.complete({ organizationId: ORG, changeId: "change_1" });

      expect(back).toEqual({ status: "applied", reason: null });
      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(state.roleWrites).toBe(1);
    });

    /** @scenario "The return applies the change, then the paid fact changes nothing" */
    it("applies on the return, and the paid fact finds it applied", async () => {
      const { state, service, pay } = await waiting();
      pay("in_seat");

      const back = await service.complete({ organizationId: ORG, changeId: "change_1" });
      await service.paymentPaid({ organizationId: ORG, payment: INVOICE });

      expect(back).toEqual({ status: "applied", reason: null });
      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(state.roleWrites).toBe(1);
    });

    /** @scenario "The return applies the change, then the paid fact changes nothing" */
    it("writes the role once when the return and the paid fact race", async () => {
      const { state, service, pay } = await waiting();
      pay("in_seat");

      await Promise.allSettled([
        service.complete({ organizationId: ORG, changeId: "change_1" }),
        service.paymentPaid({ organizationId: ORG, payment: INVOICE }),
        service.complete({ organizationId: ORG, changeId: "change_1" }),
      ]);

      expect(state.roleWrites).toBe(1);
    });

    /** @scenario "An unpaid seat invoice keeps the change waiting" */
    it("stays waiting while the invoice is unpaid", async () => {
      const { state, service } = await waiting();

      expect(await service.complete({ organizationId: ORG, changeId: "change_1" })).toEqual({
        status: "waiting",
        reason: null,
      });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
    });

    /** @scenario "A purchase while a seat payment waits reopens that payment" */
    it("reopens the waiting payment for the same change, buying nothing", async () => {
      const { service, addFullSeat } = await waiting();

      const again = await service.changeWithSeat(MAKE_ADMIN, ADMIN);

      expect(again).toEqual({
        status: "payment_required",
        changeId: "change_1",
        url: "https://pay.example",
      });
      expect(addFullSeat).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Another member's seat waits its turn behind the one already waiting" */
    it("refuses another member's seat while one payment waits", async () => {
      const { service, addFullSeat } = await waiting();

      await expect(
        service.changeWithSeat({ ...MAKE_ADMIN, userId: KIM }, ADMIN),
      ).rejects.toMatchObject({ code: "seat_payment_waiting" });
      expect(addFullSeat).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Another member's seat waits its turn behind the one already waiting" */
    it("refuses a second admin whose purchase found the invoice already held", async () => {
      const { state, service, addFullSeat, pending } = world();
      const first = { status: "payment_required", payment: INVOICE, url: "https://pay.example" };
      // The first admin's change is saved while the second one's purchase is under way.
      addFullSeat.mockImplementationOnce(async () => {
        await pending.save({
          id: "change_first",
          organizationId: ORG,
          userId: SAM,
          role: "ADMIN",
          requestedBy: { id: ADMIN.id, name: null, email: null },
          payment: INVOICE,
          url: first.url,
          status: "waiting",
          reason: null,
          createdAt: 0,
        });
        return first as SeatPurchase;
      });
      state.purchase = first as SeatPurchase;

      await expect(
        service.changeWithSeat({ ...MAKE_ADMIN, userId: KIM }, ADMIN),
      ).rejects.toMatchObject({ code: "seat_payment_waiting" });
    });

    /** @scenario "A purchase while a seat payment waits reopens that payment" */
    it("maps one held invoice to one change when two admins ask at once", async () => {
      const { state, service, pending } = world();
      state.purchase = { status: "payment_required", payment: INVOICE, url: "https://pay.example" };

      const answers = await Promise.all([
        service.changeWithSeat(MAKE_ADMIN, ADMIN),
        service.changeWithSeat(MAKE_ADMIN, ADMIN),
      ]);

      const saved = await pending.findWaitingForOrganization({ organizationId: ORG });
      expect(saved).toHaveLength(1);
      expect(answers).toEqual([
        { status: "payment_required", changeId: saved[0]!.id, url: "https://pay.example" },
        { status: "payment_required", changeId: saved[0]!.id, url: "https://pay.example" },
      ]);
    });

    /** @scenario "A paid seat whose role change is refused keeps the seat and says why" */
    it("records a paid seat whose role write is refused, with the reason", async () => {
      const { state, service, pay } = await waiting();
      pay("in_seat");
      state.refuseAfterSeat = true;

      const outcome = await service.complete({ organizationId: ORG, changeId: "change_1" });

      expect(outcome).toEqual({
        status: "seat_only",
        reason: new CannotDisableLastAdminError().message,
      });
      expect(state.paid).toBe(3);
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "seat_only",
      });
    });

    /** @scenario "A paid change asked by an admin who lost the right changes no role" */
    it("writes no role for an admin who can no longer change roles", async () => {
      const { state, service, pay } = await waiting();
      pay("in_seat");
      state.adminCanManage = false;

      const outcome = await service.complete({ organizationId: ORG, changeId: "change_1" });

      expect(outcome.status).toBe("seat_only");
      expect(state.roleWrites).toBe(0);
    });

    /** @scenario "A newer role change replaces the one waiting on its payment" */
    it("never applies the waiting change once a newer role write for the member succeeded", async () => {
      const { state, service, pay } = await waiting();
      state.paid += 1;

      const newer = await service.changeWithSeat({ ...MAKE_ADMIN, role: "MEMBER" }, ADMIN);
      pay("in_seat");
      await service.paymentPaid({ organizationId: ORG, payment: INVOICE });

      expect(newer).toMatchObject({ status: "changed", seatAdded: false });
      expect(state.roles.get(SAM)).toBe("MEMBER");
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "superseded",
        reason: "a later role change for this member replaced it",
      });
    });

    /** @scenario "A newer role change replaces the one waiting on its payment" */
    it("never writes the older role when its paid fact lands during the newer role write", async () => {
      const { state, service, pay, changeMemberRole } = await waiting();
      state.paid += 1;
      pay("in_seat");
      const write = changeMemberRole.getMockImplementation()!;
      changeMemberRole.mockImplementationOnce(async (input, by) => {
        await expect(
          service.paymentPaid({ organizationId: ORG, payment: INVOICE }),
        ).rejects.toThrow(SeatRoleChangeNotAppliedYetError);
        return write(input, by);
      });

      const newer = await service.changeWithSeat({ ...MAKE_ADMIN, role: "MEMBER" }, ADMIN);
      await service.paymentPaid({ organizationId: ORG, payment: INVOICE });

      expect(newer).toMatchObject({ status: "changed", seatAdded: false });
      expect(state.roles.get(SAM)).toBe("MEMBER");
      expect(state.roleWrites).toBe(1);
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "superseded",
      });
    });

    /** @scenario "A newer role change replaces the one waiting on its payment" */
    it("refuses a newer role write while the paid write holds the waiting change", async () => {
      const { state, service, pending } = await waiting();
      state.paid += 1;
      await pending.claim({ organizationId: ORG, id: "change_1", token: "paid-applier" });

      await expect(
        service.changeWithSeat({ ...MAKE_ADMIN, role: "MEMBER" }, ADMIN),
      ).rejects.toMatchObject({ code: "seat_payment_waiting" });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
    });

    /** @scenario "The return applies the change, then the paid fact changes nothing" */
    it("keeps the applied outcome when a stale applier's role write fails afterwards", async () => {
      const { state, service, pay, pending, changeMemberRole } = await waiting();
      pay("in_seat");
      // Another applier wrote the role and settled the change while this one's claim lapsed.
      changeMemberRole.mockImplementationOnce(async () => {
        state.roles.set(SAM, "ADMIN");
        state.roleWrites += 1;
        await pending.settle({ organizationId: ORG, id: "change_1", status: "applied" });
        throw new CannotDisableLastAdminError();
      });

      const outcome = await service.complete({ organizationId: ORG, changeId: "change_1" });

      expect(outcome).toEqual({ status: "applied", reason: null });
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "applied",
      });
      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(state.roleWrites).toBe(1);
    });

    /** @scenario "The return applies the change, then the paid fact changes nothing" */
    it("keeps the claim through a paid role write that outlasts the claim period", async () => {
      vi.useFakeTimers();
      try {
        const { state, service, pay, changeMemberRole } = await waiting(INVOICE, () => Date.now());
        pay("in_seat");
        const write = changeMemberRole.getMockImplementation()!;
        let finishWrite: () => void = () => {};
        changeMemberRole.mockImplementationOnce(async (input, by) => {
          await new Promise<void>((resolve) => {
            finishWrite = resolve;
          });
          return write(input, by);
        });

        const slow = service.complete({ organizationId: ORG, changeId: "change_1" });
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
        await expect(
          service.paymentPaid({ organizationId: ORG, payment: INVOICE }),
        ).rejects.toThrow(SeatRoleChangeNotAppliedYetError);
        finishWrite();

        expect(await slow).toEqual({ status: "applied", reason: null });
        expect(state.roleWrites).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    /** @scenario "A paid fact that cannot apply yet is delivered again" */
    it("throws on the paid fact while another applier holds the change", async () => {
      const { service, pay, pending } = await waiting();
      pay("in_seat");
      await pending.claim({ organizationId: ORG, id: "change_1", token: "another-applier" });

      await expect(service.paymentPaid({ organizationId: ORG, payment: INVOICE })).rejects.toThrow(
        SeatRoleChangeNotAppliedYetError,
      );
    });

    /** @scenario "A paid fact that cannot apply yet is delivered again" */
    it("throws on the paid fact while billing still finds the invoice unpaid", async () => {
      const { service } = await waiting();

      await expect(service.paymentPaid({ organizationId: ORG, payment: INVOICE })).rejects.toThrow(
        SeatRoleChangeNotAppliedYetError,
      );
    });

    /** @scenario "A failed or abandoned payment changes nothing" */
    it("fails a voided payment and keeps the role", async () => {
      const { state, service } = await waiting();
      state.payments.set("in_seat", "failed");

      expect(await service.complete({ organizationId: ORG, changeId: "change_1" })).toEqual({
        status: "failed",
        reason: null,
      });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
      expect(state.paid).toBe(2);
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "failed",
      });
    });

    /** @scenario "A plan with no Stripe subscription buys the seat through checkout" */
    it("applies once the seat checkout is paid, exactly once", async () => {
      const checkout: SeatPayment = { kind: "checkout", subscriptionId: "sub_db_checkout" };
      const { state, service, pay } = await waiting(checkout);
      pay("sub_db_checkout");

      await service.paymentPaid({ organizationId: ORG, payment: checkout });
      await service.paymentPaid({ organizationId: ORG, payment: checkout });
      await service.complete({ organizationId: ORG, changeId: "change_1" });

      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(state.roleWrites).toBe(1);
    });

    /** @scenario "An adopted seat checkout waits for its own paid fact" */
    it("waits on the return, then applies on the checkout's own paid fact", async () => {
      const checkout: SeatPayment = { kind: "checkout", subscriptionId: "sub_db_checkout" };
      const { state, service } = await waiting(checkout);
      // Billing finds the adopted row cancelled: open until the paid fact names it.
      state.paid += 1;

      expect((await service.complete({ organizationId: ORG, changeId: "change_1" })).status).toBe(
        "waiting",
      );
      await service.paymentPaid({ organizationId: ORG, payment: checkout });

      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(state.roleWrites).toBe(1);
    });

    /** @scenario "An abandoned seat checkout fails its change" */
    it("fails the change of a seat checkout billing abandoned", async () => {
      const checkout: SeatPayment = { kind: "checkout", subscriptionId: "sub_db_checkout" };
      const { state, service } = await waiting(checkout);

      await service.paymentsAbandoned({
        organizationId: ORG,
        subscriptionIds: ["sub_db_checkout"],
      });

      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "failed",
      });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
    });

    /** @scenario "The return applies the change, then the paid fact changes nothing" */
    it("answers the settled outcome when a purchase finds its held invoice already settled", async () => {
      const { state, service, addFullSeat, pending } = world();
      const held = { status: "payment_required", payment: INVOICE, url: "https://pay.example" };
      // Another admin's change for the same invoice applied while this purchase was under way.
      addFullSeat.mockImplementationOnce(async () => {
        await pending.save({
          id: "change_first",
          organizationId: ORG,
          userId: SAM,
          role: "ADMIN",
          requestedBy: { id: ADMIN.id, name: null, email: null },
          payment: INVOICE,
          url: held.url,
          status: "waiting",
          reason: null,
          createdAt: 0,
        });
        await pending.settle({ organizationId: ORG, id: "change_first", status: "applied" });
        return held as SeatPurchase;
      });
      state.purchase = held as SeatPurchase;

      const answer = await service.changeWithSeat(MAKE_ADMIN, ADMIN);

      expect(answer).toEqual({ status: "changed", seatAdded: true, teamsLeftWithoutAdmin: [] });
    });

    /** @scenario "A failed or abandoned payment changes nothing" */
    it("answers the stored outcome when its failed settle loses to another one", async () => {
      const { service, pending, settleSeatPayment } = await waiting();
      settleSeatPayment.mockImplementationOnce(async () => {
        await pending.settle({
          organizationId: ORG,
          id: "change_1",
          status: "seat_only",
          reason: "x",
        });
        return { status: "failed" };
      });

      expect(await service.complete({ organizationId: ORG, changeId: "change_1" })).toEqual({
        status: "seat_only",
        reason: "x",
      });
    });

    /** @scenario "A failed or abandoned payment changes nothing" */
    it("answers not found when the change expired while its failed settle lost", async () => {
      let clock = 1_000;
      const { service, settleSeatPayment } = await waiting(INVOICE, () => clock);
      settleSeatPayment.mockImplementationOnce(async () => {
        clock += 8 * 24 * 60 * 60 * 1000;
        return { status: "failed" };
      });

      await expect(
        service.complete({ organizationId: ORG, changeId: "change_1" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    /** @scenario "A failed or abandoned payment changes nothing" */
    it("applies nothing when the change expired while it was being claimed", async () => {
      let clock = 1_000;
      const { state, service, pay, pending } = await waiting(INVOICE, () => clock);
      pay("in_seat");
      const claim = pending.claim.bind(pending);
      vi.spyOn(pending, "claim").mockImplementation(async (input) => {
        const granted = await claim(input);
        clock += 8 * 24 * 60 * 60 * 1000;
        return granted;
      });

      await expect(
        service.complete({ organizationId: ORG, changeId: "change_1" }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(state.roles.get(SAM)).toBe("EXTERNAL");
      expect(state.roleWrites).toBe(0);
    });

    /** @scenario "The paid invoice applies the change, then the return changes nothing" */
    it("answers applied when only freeing the claim fails afterwards", async () => {
      const { state, service, pay, pending } = await waiting();
      pay("in_seat");
      vi.spyOn(pending, "release").mockRejectedValue(new Error("redis down"));

      expect(await service.complete({ organizationId: ORG, changeId: "change_1" })).toEqual({
        status: "applied",
        reason: null,
      });
      expect(state.roles.get(SAM)).toBe("ADMIN");
    });

    /** @scenario "A paid change asked by an admin who lost the right changes no role" */
    it("settles nothing for a lost right once its claim passed to another applier", async () => {
      const { state, service, pay, pending } = await waiting();
      pay("in_seat");
      state.adminCanManage = false;
      vi.spyOn(pending, "renew").mockResolvedValueOnce(false);

      expect(await service.complete({ organizationId: ORG, changeId: "change_1" })).toEqual({
        status: "waiting",
        reason: null,
      });
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "waiting",
      });
    });

    /** @scenario "A newer role change replaces the one waiting on its payment" */
    it("retries ending the replaced change", async () => {
      const { state, service, pending } = await waiting();
      state.paid += 1;
      const settle = pending.settle.bind(pending);
      vi.spyOn(pending, "settle")
        .mockRejectedValueOnce(new Error("redis down"))
        .mockImplementation(settle);

      await service.changeWithSeat({ ...MAKE_ADMIN, role: "MEMBER" }, ADMIN);

      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "superseded",
      });
    });

    /** @scenario "A replaced change whose settling failed never applies its older role" */
    it("keeps the newer role when ending the replaced change keeps failing, then supersedes the paid write", async () => {
      const { state, service, pending, pay } = await waiting();
      state.paid += 1;
      const settle = pending.settle.bind(pending);
      const failing = vi.spyOn(pending, "settle").mockRejectedValue(new Error("redis down"));

      const newer = await service.changeWithSeat({ ...MAKE_ADMIN, role: "MEMBER" }, ADMIN);
      failing.mockImplementation(settle);
      pay("in_seat");
      await service.paymentPaid({ organizationId: ORG, payment: INVOICE });

      expect(newer).toMatchObject({ status: "changed", seatAdded: false });
      expect(state.roles.get(SAM)).toBe("MEMBER");
      expect(state.roleWrites).toBe(1);
      expect(await service.complete({ organizationId: ORG, changeId: "change_1" })).toEqual({
        status: "superseded",
        reason: "a later role change for this member replaced it",
      });
    });

    /** @scenario "A replaced change whose settling failed never applies its older role" */
    it("supersedes the paid change after any later role write, even one made elsewhere", async () => {
      const { state, service, pay } = await waiting();
      state.roleVersion += 1;
      state.roles.set(SAM, "MEMBER");
      pay("in_seat");

      const outcome = await service.complete({ organizationId: ORG, changeId: "change_1" });

      expect(outcome.status).toBe("superseded");
      expect(state.roles.get(SAM)).toBe("MEMBER");
    });

    /** @scenario "A replaced change whose settling failed never applies its older role" */
    it("applies a paid change on retry when no later role write committed", async () => {
      const { state, service, pay, pending } = await waiting();
      pay("in_seat");
      const held = { organizationId: ORG, id: "change_1", token: "other-applier" };
      await pending.claim(held);

      await expect(service.paymentPaid({ organizationId: ORG, payment: INVOICE })).rejects.toThrow(
        SeatRoleChangeNotAppliedYetError,
      );
      await pending.release(held);
      await service.paymentPaid({ organizationId: ORG, payment: INVOICE });

      expect(state.roles.get(SAM)).toBe("ADMIN");
      expect(await service.pendingFor({ organizationId: ORG, userId: SAM })).toMatchObject({
        status: "applied",
      });
    });

    it("refuses a change another organization asks about", async () => {
      const { service } = await waiting();

      await expect(
        service.complete({ organizationId: "org_other", changeId: "change_1" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
  });
});
