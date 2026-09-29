/**
 * The monthly statement mail over the process's mail member.
 * Spec: specs/self-hosting/connected-services/connected-billing.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EmailContent, EmailDelivery } from "@langwatch/mail";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryBillingStore } from "../../../repositories/memory/memory.billing.store.ts";
import { MemoryConnectedBillingRepository } from "../../../repositories/memory/memory.connected-billing.repository.ts";
import { ConnectedMonthlyStatementService } from "../../../services/connected-monthly-statement.service.ts";
import { SesConnectedStatementMailChannel } from "../ses.connected-statement-mail.channel.ts";

const AUGUST = Temporal.Instant.from("2026-08-01T00:00:00Z");

function mailer(send: (content: EmailContent) => Promise<unknown>) {
  return createApiFixture<EmailDelivery>({ defaultFrom: () => "billing@langwatch.ai", send });
}

async function statementRun(send: (content: EmailContent) => Promise<unknown>) {
  const repository = MemoryConnectedBillingRepository.create(MemoryBillingStore.create());
  const account = await repository.createAccount({
    organizationId: "org-acme",
    stripeCustomerId: "cus_acme",
    usageSubscriptionId: null,
    usageSubscriptionItemId: null,
    termStartsAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    termEndsAt: Temporal.Instant.from("2027-01-01T00:00:00Z"),
    commitUsdCents: 100_000,
    seatCurrency: "USD",
    seatRateCents: 3_000,
    seats: 50,
    bankTransferType: null,
    bankTransferCountry: null,
    billingEmail: "billing@acme.example",
    pendingRenewal: null,
  });
  const service = ConnectedMonthlyStatementService.create({
    repository,
    sources: {
      findConnectedCustomers: async () => [
        { organizationId: "org-acme", organizationName: "ACME" },
      ],
      findSpendByService: async () => [{ service: "instant_evals", usdCents: 4_200 }],
      getCommitDrawdown: async () => ({ kind: "read", usdCents: 12_500 }),
      getSeats: async () => ({ licensed: 50, reported: 43 }),
    },
    mail: SesConnectedStatementMailChannel.create(mailer(send)),
    now: () => Temporal.Instant.from("2026-09-03T06:00:00Z"),
  });
  const summary = await service.run();
  const recorded = await repository.hasSentStatement({ accountId: account.id, month: AUGUST });
  return { summary, recorded };
}

describe("SesConnectedStatementMailChannel", () => {
  describe("when the month's statement runs", () => {
    /** @scenario "The monthly statement is mailed to the billing contact" */
    it("mails the billing contact the month's statement, named by the month", async () => {
      const sent: EmailContent[] = [];

      const { summary, recorded } = await statementRun(async (content) => {
        sent.push(content);
      });

      expect(summary.sent).toBe(1);
      expect(recorded).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe("billing@acme.example");
      expect(sent[0]?.subject).toContain("August 2026");
      expect(sent[0]?.html).toContain("ACME");
    });
  });

  describe("when the mail provider refuses the statement", () => {
    /** @scenario "A statement whose mail fails is not recorded as sent" */
    it("counts the failure and leaves the month unrecorded for the next tick", async () => {
      const { summary, recorded } = await statementRun(async () => {
        throw new Error("provider refused");
      });

      expect(summary).toMatchObject({ sent: 0, failed: 1 });
      expect(recorded).toBe(false);
    });
  });
});
