/**
 * The words and actions of the seat drawer, the confirm and the toast.
 * @see specs/licensing/seat-buying.feature
 */
import { Currency } from "@langwatch/enterprise-billing-contract";
import { describe, expect, it } from "vitest";

import {
  type GrowthSeatPlan,
  freeSeatPlan,
  growthMinimumSeats,
  growthSeatPlan,
  joinEmails,
  seatChangeToast,
  seatConfirm,
  upgradeMinimumHint,
  upgradeTotal,
} from "../seat-purchase.ts";

const EUR = { seatCents: 2900, currency: Currency.EUR, periodSuffix: "/mo" };
const DEC_1 = Date.UTC(2026, 11, 1);
const NOV_6 = Date.UTC(2026, 10, 6);

const growth = (overrides: Partial<GrowthSeatPlan>): GrowthSeatPlan => ({
  paid: 3,
  seats: 3,
  inUse: 3,
  invites: 0,
  price: EUR,
  quote: undefined,
  developer: undefined,
  developerDueCents: 0,
  periodEndsAt: DEC_1,
  ...overrides,
});

describe("upgradeTotal()", () => {
  it("totals the seats and breaks the price down", () => {
    expect(upgradeTotal({ seats: 3, price: EUR })).toEqual({
      total: "€87/mo",
      breakdown: "3 seats × €29",
    });
  });

  it("names no minimum for one seat", () => {
    expect(upgradeMinimumHint(1)).toBeUndefined();
  });
});

describe("freeSeatPlan()", () => {
  it("invites at once while the people fit Free", () => {
    const plan = freeSeatPlan({ includedSeats: 2, inUse: 1, invites: 1, price: EUR });
    expect(plan.action).toEqual({ kind: "invite", label: "Invite 1 person" });
    expect(plan.rowChip).toBe("Invited now");
    expect(plan.note).toBeUndefined();
  });

  it("becomes the upgrade for every person once past Free", () => {
    const plan = freeSeatPlan({ includedSeats: 2, inUse: 1, invites: 2, price: EUR });
    expect(plan.action).toEqual({
      kind: "upgrade",
      label: "Upgrade and invite 2 people · €87/mo",
      seats: 3,
    });
    expect(plan.rowChip).toBe("Invited after payment");
  });

  it("has nothing to do with no one planned", () => {
    expect(freeSeatPlan({ includedSeats: 2, inUse: 1, invites: 0, price: EUR }).action.kind).toBe(
      "none",
    );
  });
});

describe("growthSeatPlan()", () => {
  it("never goes under the people holding or invited to a seat", () => {
    expect(growthMinimumSeats({ inUse: 3, invites: 2 })).toBe(5);
    expect(growthMinimumSeats({ inUse: 0, invites: 0 })).toBe(1);
  });

  it("asks to confirm both changes at once", () => {
    const plan = growthSeatPlan(
      growth({ seats: 4, developer: { current: 0, target: 2, unitCents: 500 } }),
    );
    expect(plan.action).toEqual({ kind: "change", label: "Confirm seat changes" });
  });

  it("invites into seats already paid for", () => {
    const plan = growthSeatPlan(growth({ paid: 5, seats: 5, invites: 1 }));
    expect(plan.action).toEqual({ kind: "invite", label: "Invite 1 person" });
  });
});

describe("seatConfirm()", () => {
  const quote = {
    amountDueCents: 2417,
    formattedAmountDue: "€24.17",
    formattedCreditApplied: null,
    formattedRecurringTotal: "€116",
    billingInterval: "month" as const,
    quotedAt: 1,
    appliesAt: null,
    keptSeats: null,
    formattedKeptRecurringTotal: null,
  };

  it("names the charge today and the period it covers", () => {
    const confirm = seatConfirm({
      plan: growth({ seats: 4, invites: 1, quote }),
      emails: ["qux@acme.example"],
      todayMs: NOV_6,
    });
    expect(confirm.title).toBe("Add 1 seat to your organization?");
    expect(confirm.lines[0]).toEqual({
      label: "Today",
      detail: "Charged today to the card on file, for 6 Nov to 1 Dec.",
      value: "€24.17",
    });
    expect(confirm.lines[1]).toEqual({
      label: "From 1 Dec",
      detail: "4 seats × €29",
      value: "€116/mo",
    });
    expect(confirm.body).toBe("qux@acme.example gets the invite as soon as the seat is added.");
    expect(confirm.actionLabel).toBe("Pay €24.17 and add");
  });

  it("says nothing is due when the seats are already kept", () => {
    const confirm = seatConfirm({
      plan: growth({ seats: 4, quote: { ...quote, amountDueCents: 0 } }),
      emails: [],
      todayMs: NOV_6,
    });
    expect(confirm.lines[0]?.detail).toBe("Nothing to pay today.");
    expect(confirm.actionLabel).toBe("Confirm");
  });

  /** @scenario "Lowering full seats while adding Developer seats names what is due today" */
  it("names the Developer seat charge due today when the full seats go down", () => {
    const confirm = seatConfirm({
      plan: growth({
        paid: 5,
        seats: 3,
        developer: { current: 0, target: 2, unitCents: 500 },
        developerDueCents: 833,
      }),
      emails: [],
      todayMs: NOV_6,
    });
    expect(confirm.lines[0]).toEqual({
      label: "Today",
      detail: "Charged today to the card on file, for 6 Nov to 1 Dec.",
      value: "€8.33",
    });
    expect(confirm.lines.map((line) => line.label)).toEqual(["Today", "Until 1 Dec", "From 1 Dec"]);
  });

  it("adds no Today line when only the full seats go down", () => {
    const confirm = seatConfirm({
      plan: growth({ paid: 5, seats: 3 }),
      emails: [],
      todayMs: NOV_6,
    });
    expect(confirm.lines.map((line) => line.label)).toEqual(["Until 1 Dec", "From 1 Dec"]);
  });
});

describe("seatChangeToast()", () => {
  it("says the seat was added and who was invited", () => {
    expect(seatChangeToast({ paid: 3, seats: 4, emails: ["qux@acme.example"], day: "1 Dec" })).toBe(
      "Seat added. You now pay for 4 seats. Invite sent to qux@acme.example.",
    );
  });

  it("says when a lower count applies", () => {
    expect(seatChangeToast({ paid: 5, seats: 3, emails: [], day: "1 Dec" })).toBe(
      "From 1 Dec you pay for 3 seats.",
    );
  });

  it("joins addresses in plain English", () => {
    expect(joinEmails(["a@x.example", "b@x.example", "c@x.example"])).toBe(
      "a@x.example, b@x.example and c@x.example",
    );
  });
});
