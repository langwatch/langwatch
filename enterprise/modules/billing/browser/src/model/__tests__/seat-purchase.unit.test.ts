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
  heldSeatsOf,
  joinEmails,
  seatChangeToast,
  seatConfirm,
  upgradeMinimumHint,
  upgradeTotal,
} from "../seat-purchase.ts";

const EUR = { seatCents: 2900, currency: Currency.EUR, periodSuffix: "/mo" };
const DEC_1 = Date.UTC(2026, 11, 1);
const NOV_6 = Date.UTC(2026, 10, 6);

/** A hold the server lists for `userId`, freeing at `seatFreesAt`. */
const hold = (userId: string, seatFreesAt: string) => ({
  userId,
  email: `${userId}@acme.example`,
  seatFreesAt,
});
const noOneBack = { fullMemberIds: new Set<string>(), fullInviteEmails: new Set<string>() };

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
      note: "excl. VAT",
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

  it("names the held seat and the day it frees", () => {
    const held = heldSeatsOf({
      holds: [hold("removed", "2026-12-07T10:00:00.000Z")],
      ...noOneBack,
    });
    const plan = freeSeatPlan({ includedSeats: 2, inUse: 2, held, invites: 0, price: EUR });
    expect(plan.heading).toBe("Free includes 2 seats. 2 in use, 1 of them held until 7 Dec.");
  });

  it("says only the count when the server lists no hold", () => {
    const held = heldSeatsOf({ holds: [], ...noOneBack });
    expect(held).toEqual({ count: 0 });
    expect(freeSeatPlan({ includedSeats: 2, inUse: 2, held, invites: 0, price: EUR }).heading).toBe(
      "Free includes 2 seats. 2 in use.",
    );
  });

  it("leaves out a hold whose person holds a full seat again", () => {
    const held = heldSeatsOf({
      holds: [
        hold("back", "2026-12-07T10:00:00.000Z"),
        hold("invited", "2026-12-08T10:00:00.000Z"),
      ],
      fullMemberIds: new Set(["back"]),
      fullInviteEmails: new Set(["invited@acme.example"]),
    });
    expect(held).toEqual({ count: 0 });
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

  it("names several held seats by the first to free", () => {
    const held = heldSeatsOf({
      holds: [hold("a", "2026-12-20T10:00:00.000Z"), hold("b", "2026-12-07T10:00:00.000Z")],
      ...noOneBack,
    });
    const plan = growthSeatPlan(growth({ paid: 5, seats: 4, inUse: 4, held }));
    expect(plan.heading).toBe("You pay for 5. 4 in use, 2 of them held, the first until 7 Dec.");
    expect(plan.minimumHint).toBe(
      "2 people use full seats and 2 more are held, the first until 7 Dec. Remove someone in Users to go lower.",
    );
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
      note: "excl. VAT",
    });
    expect(confirm.body).toBe("qux@acme.example gets the invite as soon as the seat is added.");
    expect(confirm.actionLabel).toBe("Pay €24.17 and add");
  });

  describe("when the charge today carries VAT", () => {
    const taxed = { ...quote, amountDueCents: 2924, formattedAmountDue: "€29.24", taxCents: 507 };

    it("charges the VAT-inclusive amount and splits the VAT out under it", () => {
      const confirm = seatConfirm({
        plan: growth({ seats: 4, invites: 1, quote: taxed }),
        emails: ["qux@acme.example"],
        todayMs: NOV_6,
      });
      expect(confirm.lines[0]).toEqual({
        label: "Today",
        detail: "Charged today to the card on file, for 6 Nov to 1 Dec.",
        value: "€29.24",
        note: "€24.17 + €5.07 VAT",
      });
      expect(confirm.lines[1]).toMatchObject({ value: "€116/mo", note: "excl. VAT" });
      expect(confirm.actionLabel).toBe("Pay €29.24 and add");
    });

    it("adds the Developer seats' VAT to the full seats' VAT", () => {
      const confirm = seatConfirm({
        plan: growth({
          seats: 4,
          quote: taxed,
          developer: { current: 0, target: 2, unitCents: 500 },
          developerDueCents: 1008,
          developerTaxCents: 175,
        }),
        emails: [],
        todayMs: NOV_6,
      });
      expect(confirm.lines[0]).toMatchObject({ value: "€39.32", note: "€32.50 + €6.82 VAT" });
    });

    /** @scenario "The drawer summary splits VAT out of the amount due today" */
    it("splits the VAT out in the drawer summary too", () => {
      const { summary } = growthSeatPlan(growth({ seats: 4, quote: taxed }));
      expect(summary).toContainEqual(
        expect.objectContaining({
          label: "Due today, prorated",
          value: "€29.24",
          note: "€24.17 + €5.07 VAT",
        }),
      );
      expect(summary).toContainEqual(
        expect.objectContaining({ label: "Then from 1 Dec", value: "€116/mo", note: "excl. VAT" }),
      );
    });
  });

  /** @scenario "A charge today with no VAT names no split" */
  it("names no VAT split for a charge without VAT, and still says the price excludes it", () => {
    const confirm = seatConfirm({
      plan: growth({ seats: 4, quote: { ...quote, taxCents: 0 } }),
      emails: [],
      todayMs: NOV_6,
    });
    expect(confirm.lines[0]?.value).toBe("€24.17");
    expect(confirm.lines[0]?.note).toBeUndefined();
    expect(confirm.lines[1]?.note).toBe("excl. VAT");
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

  /** @scenario "The message after a seat change names the Developer seats that changed" */
  it("names the Developer seats that changed", () => {
    const toast = (seats: number, target: number) =>
      seatChangeToast({
        paid: 4,
        seats,
        emails: [],
        day: "1 Dec",
        developer: { current: 2, target },
      });
    expect(toast(4, 3)).toBe("You now pay for 3 developer seats.");
    expect(toast(4, 1)).toBe("From 1 Dec you pay for 1 developer seat.");
    expect(toast(5, 3)).toBe("Seat added. You now pay for 5 seats and 3 developer seats.");
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
