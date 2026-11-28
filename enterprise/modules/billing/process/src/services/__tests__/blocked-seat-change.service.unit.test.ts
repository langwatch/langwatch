// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Seat changes refused for two live subscriptions, and the one email after.
 * @see ../../../../../../specs/licensing/proration-preview.feature
 */
import { AmbiguousSubscriptionError } from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryBillingFixedEmailChannel } from "../../channels/memory/memory.billing.channels.ts";
import type { BillingAccountFactsRepository } from "../../repositories/billing-account-facts.repository.ts";
import { MemoryBlockedSeatChangeRepository } from "../../repositories/memory/memory.blocked-seat-change.repository.ts";
import type { SeatEventProrationQuote } from "../../rules/seat-event-quote.rules.ts";
import { BlockedSeatChangeService } from "../blocked-seat-change.service.ts";

const ORG = "org_acme";
const NOW = Temporal.Instant.from("2026-11-26T15:00:00Z");

const QUOTE: SeatEventProrationQuote = {
  amountDueCents: 1933,
  formattedAmountDue: "€19.33",
  formattedCreditApplied: null,
  taxCents: 0,
  formattedAmountDueExcludingTax: null,
  formattedTax: null,
  formattedRecurringTotal: "€145",
  formattedSeatPrice: "€29",
  billingInterval: "month",
  quotedAt: Math.floor(NOW.epochMilliseconds / 1000),
  appliesAt: null,
  keptSeats: null,
  formattedKeptRecurringTotal: null,
  renewsAt: Temporal.Instant.from("2026-12-01T00:00:00Z").epochMilliseconds,
};

function world() {
  const changes = MemoryBlockedSeatChangeRepository.create();
  const emails = MemoryBillingFixedEmailChannel.create();
  const state = { blocked: false };
  const quote = vi.fn(async () => {
    if (state.blocked) throw new AmbiguousSubscriptionError(2);
    return QUOTE;
  });
  const service = BlockedSeatChangeService.create({
    changes,
    organizations: createApiFixture<
      Pick<BillingAccountFactsRepository, "findName" | "findMemberEmails">
    >({
      findName: async () => ({ id: ORG, name: "ACME" }),
      findMemberEmails: async ({ userIds }) =>
        userIds.map((userId) => ({ userId, email: `${userId}@acme.test` })),
    }),
    quote,
    emails,
    publicBaseUrl: "https://app.test",
    now: () => NOW,
  });
  const roleChange = (userId = "user_admin") =>
    service.record({
      organizationId: ORG,
      userId,
      attempt: { kind: "role_change", memberName: "Jane Doe", role: "Admin" },
      seats: 1,
    });
  return { changes, emails, state, quote, service, roleChange };
}

beforeEach(() => vi.useFakeTimers({ now: NOW.epochMilliseconds, toFake: ["Date"] }));

describe("given an admin's seat change was refused for two live subscriptions", () => {
  /** @scenario "A seat change refused for two live subscriptions is remembered for the admin who tried" */
  it("keeps the admin and the role change they tried", async () => {
    const { changes, roleChange } = world();

    await roleChange();

    expect(await changes.findWaiting()).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        userId: "user_admin",
        attempt: { kind: "role_change", memberName: "Jane Doe", role: "Admin" },
        seats: 1,
      }),
    ]);
  });

  /** @scenario "A refused role change asked again while it waits is kept once" */
  it("keeps the same attempt once, and another member's attempt beside it", async () => {
    const { changes, service, roleChange } = world();

    await roleChange();
    await service.record({
      organizationId: ORG,
      userId: "user_admin",
      attempt: { role: "Admin", memberName: "Jane Doe", kind: "role_change" },
      seats: 1,
    });
    await service.record({
      organizationId: ORG,
      userId: "user_admin",
      attempt: { kind: "role_change", memberName: "Kim Lee", role: "Admin" },
      seats: 1,
    });

    expect((await changes.findWaiting()).map((change) => change.attempt)).toEqual([
      { kind: "role_change", memberName: "Jane Doe", role: "Admin" },
      { kind: "role_change", memberName: "Kim Lee", role: "Admin" },
    ]);
  });

  it("keeps the same attempt by another admin, or in another organization, beside it", async () => {
    const { changes, service, roleChange } = world();
    const attempt = { kind: "role_change", memberName: "Jane Doe", role: "Admin" } as const;

    await roleChange();
    await roleChange("user_other_admin");
    await service.record({ organizationId: "org_other", userId: "user_admin", attempt, seats: 1 });

    expect(
      (await changes.findWaiting()).map(({ organizationId, userId }) => [organizationId, userId]),
    ).toEqual([
      [ORG, "user_admin"],
      [ORG, "user_other_admin"],
      ["org_other", "user_admin"],
    ]);
  });

  describe("when the organization is back on one subscription", () => {
    /** @scenario "The admin hears once that billing is fixed" */
    it("emails that admin once with what finishing the change costs now", async () => {
      const { emails, service, roleChange } = world();
      await roleChange();
      await roleChange();

      expect(await service.noticeFixed()).toEqual({ sent: 1, waiting: 0 });
      expect(await service.noticeFixed()).toEqual({ sent: 0, waiting: 0 });

      expect(emails.sent).toEqual([
        {
          to: "user_admin@acme.test",
          email: {
            organizationName: "ACME",
            tried: { kind: "role_change", memberName: "Jane Doe", role: "Admin" },
            triedWhen: "earlier today",
            seats: 1,
            dueToday: "€19.33",
            recurringTotal: "€145",
            interval: "month",
            renewsOn: "1 December 2026",
            actionUrl: "https://app.test/settings/members",
          },
        },
      ]);
    });
  });

  describe("when the organization still holds two live subscriptions", () => {
    /** @scenario "No billing-fixed email while the subscriptions are still ambiguous" */
    it("sends nothing and keeps the change waiting", async () => {
      const { changes, emails, state, service, roleChange } = world();
      state.blocked = true;
      await roleChange();

      expect(await service.noticeFixed()).toEqual({ sent: 0, waiting: 1 });

      expect(emails.sent).toEqual([]);
      expect(await changes.findWaiting()).toHaveLength(1);
    });
  });

  describe("when a new refusal for the same admin lands while the email is sent", () => {
    it("tells the admin about it on the next pass", async () => {
      const { changes, quote, service, roleChange } = world();
      await roleChange();
      quote.mockImplementationOnce(async () => {
        vi.setSystemTime(NOW.epochMilliseconds + 60_000);
        await service.record({
          organizationId: ORG,
          userId: "user_admin",
          attempt: { kind: "role_change", memberName: "Kim Lee", role: "Admin" },
          seats: 1,
        });
        return QUOTE;
      });

      expect(await service.noticeFixed()).toEqual({ sent: 1, waiting: 0 });

      expect((await changes.findWaiting()).map((change) => change.attempt)).toEqual([
        { kind: "role_change", memberName: "Kim Lee", role: "Admin" },
      ]);
    });
  });

  describe("when the refusal cannot be stored", () => {
    it("says it was not kept, and never throws", async () => {
      const { changes, roleChange } = world();
      vi.spyOn(changes, "record").mockRejectedValueOnce(new Error("database down"));

      await expect(roleChange()).resolves.toBe(false);
      await expect(roleChange()).resolves.toBe(true);
    });
  });

  describe("when the mail provider refuses the address", () => {
    it("keeps the change waiting for the next pass", async () => {
      const { changes, emails, service, roleChange } = world();
      emails.refused.add("user_admin@acme.test");
      await roleChange();

      await service.noticeFixed();

      expect(await changes.findWaiting()).toHaveLength(1);
    });
  });
});
