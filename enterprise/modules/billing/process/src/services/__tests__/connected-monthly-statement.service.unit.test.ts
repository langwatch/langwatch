/**
 * The monthly usage statement of a connected self-hosted customer.
 * Spec: specs/self-hosting/connected-services/connected-billing.feature
 */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryConnectedStatementMailChannel } from "../../channels/memory/memory.connected-statement-mail.channel.ts";
import { MemoryBillingStore } from "../../repositories/memory/memory.billing.store.ts";
import { MemoryConnectedBillingRepository } from "../../repositories/memory/memory.connected-billing.repository.ts";
import { previousMonthStart } from "../../rules/connected-statement.rules.ts";
import {
  ConnectedMonthlyStatementService,
  type CommitDrawdown,
  type ConnectedCustomer,
  type ConnectedStatementSources,
  type StatementSeats,
  type StatementSpendLine,
} from "../connected-monthly-statement.service.ts";

const at = (iso: string): Instant => Temporal.Instant.from(iso);

/** A day in September, so the statement covers August. */
const NOW = at("2026-09-03T06:00:00Z");
const AUGUST = at("2026-08-01T00:00:00Z");
const SEPTEMBER = at("2026-09-01T00:00:00Z");

/** What the directory, the ledger, the contract budget and the registry answer. */
class RecordedSources implements ConnectedStatementSources {
  readonly spendAsked: { organizationId: string; from: Instant; until: Instant }[] = [];

  constructor(
    private readonly customers: ConnectedCustomer[],
    private readonly spend: Record<string, StatementSpendLine[] | "broken">,
    private readonly drawdown: CommitDrawdown = { kind: "read", usdCents: 12_500 },
    private readonly seats: StatementSeats = { licensed: 50, reported: 53 },
  ) {}

  async findConnectedCustomers(): Promise<ConnectedCustomer[]> {
    return this.customers;
  }

  async findSpendByService(input: {
    organizationId: string;
    from: Instant;
    until: Instant;
  }): Promise<StatementSpendLine[]> {
    this.spendAsked.push(input);
    const lines = this.spend[input.organizationId] ?? [];
    if (lines === "broken") throw new Error("ledger unreachable");
    return lines;
  }

  async getCommitDrawdown(): Promise<CommitDrawdown> {
    return this.drawdown;
  }

  async getSeats(): Promise<StatementSeats> {
    return this.seats;
  }
}

async function harness({
  customers = [{ organizationId: "org-acme", organizationName: "ACME" }],
  spend = { "org-acme": [{ service: "instant_evals", usdCents: 4_200 }] } as Record<
    string,
    StatementSpendLine[] | "broken"
  >,
  drawdown,
}: {
  customers?: ConnectedCustomer[];
  spend?: Record<string, StatementSpendLine[] | "broken">;
  drawdown?: CommitDrawdown;
} = {}) {
  const store = MemoryBillingStore.create();
  const repository = MemoryConnectedBillingRepository.create(store);
  for (const customer of customers) {
    await repository.createAccount({
      organizationId: customer.organizationId,
      stripeCustomerId: `cus_${customer.organizationId}`,
      usageSubscriptionId: null,
      usageSubscriptionItemId: null,
      termStartsAt: at("2026-01-01T00:00:00Z"),
      termEndsAt: at("2027-01-01T00:00:00Z"),
      commitUsdCents: 100_000,
      seatCurrency: "USD",
      seatRateCents: 3_000,
      seats: 50,
      bankTransferType: null,
      bankTransferCountry: null,
      billingEmail: `billing@${customer.organizationId}.example`,
      pendingRenewal: null,
    });
  }
  const sources = new RecordedSources(customers, spend, drawdown);
  const mail = MemoryConnectedStatementMailChannel.create();
  const service = ConnectedMonthlyStatementService.create({
    repository,
    sources,
    mail,
    now: () => NOW,
  });

  return { service, sources, mail, store };
}

describe("the monthly statement of a connected customer", () => {
  describe("given the customer used hosted services during the month", () => {
    /** @scenario "The billing contact receives a monthly usage statement" */
    it("sends the spend by service, the commit, the credit left and the seats", async () => {
      const { service, mail } = await harness({
        spend: {
          "org-acme": [
            { service: "instant_evals", usdCents: 4_200 },
            { service: "managed_models", usdCents: 800 },
          ],
        },
      });

      const summary = await service.run();

      expect(summary.sent).toBe(1);
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]).toMatchObject({
        to: "billing@org-acme.example",
        organizationName: "ACME",
        month: AUGUST,
        spendByService: [
          { service: "instant_evals", usdCents: 4_200 },
          { service: "managed_models", usdCents: 800 },
        ],
        totalUsdCents: 5_000,
        commitUsdCents: 100_000,
        commitDrawnDownUsdCents: 12_500,
        creditRemainingUsdCents: 87_500,
        seats: { licensed: 50, reported: 53 },
      });
    });

    /** @scenario "The billing contact receives a monthly usage statement" */
    it("covers the month that has just ended", async () => {
      const { service, sources } = await harness();

      await service.run();

      expect(previousMonthStart(NOW)).toEqual(AUGUST);
      expect(sources.spendAsked[0]).toMatchObject({ from: AUGUST, until: SEPTEMBER });
    });

    it("says the drawdown is unknown rather than zero when it cannot be read", async () => {
      const { service, mail } = await harness({ drawdown: { kind: "unavailable" } });

      await service.run();

      expect(mail.sent[0]).toMatchObject({
        commitDrawnDownUsdCents: null,
        creditRemainingUsdCents: null,
      });
    });
  });

  describe("given the customer used no hosted services during the month", () => {
    /** @scenario "A month with no usage sends no statement" */
    it("sends nothing and records nothing", async () => {
      const { service, mail, store } = await harness({
        spend: { "org-acme": [{ service: "instant_evals", usdCents: 0 }] },
      });

      const summary = await service.run();

      expect(summary).toMatchObject({ sent: 0, noUsage: 1 });
      expect(mail.sent).toEqual([]);
      expect(store.connectedStatements.size).toBe(0);
    });
  });

  describe("given the statement for the month was already sent", () => {
    /** @scenario "The statement is sent once per month" */
    it("sends no second statement", async () => {
      const { service, mail, sources } = await harness();
      await service.run();

      const again = await service.run();

      expect(again).toMatchObject({ sent: 0, alreadySent: 1 });
      expect(mail.sent).toHaveLength(1);
      expect(sources.spendAsked).toHaveLength(1);
    });
  });

  describe("given one customer's statement fails", () => {
    it("still sends the others", async () => {
      const { service, mail } = await harness({
        customers: [
          { organizationId: "org-acme", organizationName: "ACME" },
          { organizationId: "org-globex", organizationName: "Globex" },
        ],
        spend: {
          "org-acme": "broken",
          "org-globex": [{ service: "instant_evals", usdCents: 900 }],
        },
      });

      const summary = await service.run();

      expect(summary).toMatchObject({ sent: 1, failed: 1 });
      expect(mail.sent.map((statement) => statement.organizationName)).toEqual(["Globex"]);
    });
  });
});
