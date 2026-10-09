/**
 * The monthly usage statement of a connected self-hosted customer.
 *
 * Boundaries mocked: the store (the billing accounts, the spend ledger, the
 * budget and the license) and the mailer.
 *
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectedMonthlyStatementService,
  type ConnectedStatement,
  type MonthlyStatementStore,
  previousMonthStart,
  type StatementAccount,
  type StatementSpendLine,
} from "../monthlyStatement.service";

const ACCOUNT_ID = "cba-1";
const ORGANIZATION_ID = "org-acme";
/** A day in September, so the statement covers August. */
const NOW = new Date("2026-09-03T06:00:00.000Z");
const AUGUST = new Date("2026-08-01T00:00:00.000Z");

function makeAccount(
  overrides: Partial<StatementAccount> = {},
): StatementAccount {
  return {
    id: ACCOUNT_ID,
    organizationId: ORGANIZATION_ID,
    organizationName: "ACME",
    billingEmail: "billing@acme.example",
    commitUsdCents: 100_000,
    ...overrides,
  };
}

interface Harness {
  service: ConnectedMonthlyStatementService;
  store: Record<keyof MonthlyStatementStore, ReturnType<typeof vi.fn>>;
  sent: ConnectedStatement[];
}

function makeHarness({
  accounts = [makeAccount()],
  spend = [
    { service: "instant_evals", usdCents: 4_200 },
  ] as StatementSpendLine[],
  drawnDownUsdCents = 12_500 as number | null,
  seats = { licensed: 50, reported: 53 },
  alreadySent = false,
}: {
  accounts?: StatementAccount[];
  spend?: StatementSpendLine[];
  drawnDownUsdCents?: number | null;
  seats?: { licensed: number; reported: number | null };
  alreadySent?: boolean;
} = {}): Harness {
  const sent: ConnectedStatement[] = [];
  const store = {
    listAccounts: vi.fn(async () => accounts),
    spendByService: vi.fn(async () => spend),
    readDrawnDownUsdCents: vi.fn(async () => drawnDownUsdCents),
    readSeats: vi.fn(async () => seats),
    hasSent: vi.fn(async () => alreadySent),
    recordSent: vi.fn(async () => undefined),
  };

  return {
    service: new ConnectedMonthlyStatementService({
      store: store as unknown as MonthlyStatementStore,
      mailer: {
        send: async (statement) => {
          sent.push(statement);
        },
      },
      now: () => NOW,
    }),
    store,
    sent,
  };
}

describe("ConnectedMonthlyStatementService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the customer used hosted services during the month", () => {
    /** @scenario "The billing contact receives a monthly usage statement" */
    it("sends the spend by service, the commit, the credit left and the seats", async () => {
      const harness = makeHarness({
        spend: [
          { service: "instant_evals", usdCents: 4_200 },
          { service: "managed_models", usdCents: 800 },
        ],
      });

      const summary = await harness.service.run();

      expect(summary.sent).toBe(1);
      expect(harness.sent).toHaveLength(1);
      expect(harness.sent[0]).toMatchObject({
        to: "billing@acme.example",
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
    it("covers the month that has just ended", () => {
      expect(previousMonthStart(NOW)).toEqual(AUGUST);
    });

    /** @scenario "The billing contact receives a monthly usage statement" */
    it("records the send so the month is settled", async () => {
      const harness = makeHarness();

      await harness.service.run();

      expect(harness.store.recordSent).toHaveBeenCalledWith({
        accountId: ACCOUNT_ID,
        month: AUGUST,
        sentAt: NOW,
      });
    });

    it("says the drawdown is unavailable rather than zero when it cannot be read", async () => {
      const harness = makeHarness({ drawnDownUsdCents: null });

      await harness.service.run();

      expect(harness.sent[0]).toMatchObject({
        commitDrawnDownUsdCents: null,
        creditRemainingUsdCents: null,
      });
    });
  });

  describe("given the customer used no hosted services during the month", () => {
    /** @scenario "A month with no usage sends no statement" */
    it("sends nothing and records nothing", async () => {
      const harness = makeHarness({ spend: [] });

      const summary = await harness.service.run();

      expect(summary).toMatchObject({ sent: 0, noUsage: 1 });
      expect(harness.sent).toEqual([]);
      expect(harness.store.recordSent).not.toHaveBeenCalled();
    });

    /** @scenario "A month with no usage sends no statement" */
    it("sends nothing when every service line is zero", async () => {
      const harness = makeHarness({
        spend: [{ service: "instant_evals", usdCents: 0 }],
      });

      await harness.service.run();

      expect(harness.sent).toEqual([]);
    });
  });

  describe("given the statement for the month was already sent", () => {
    /** @scenario "The statement is sent once per month" */
    it("sends no second statement", async () => {
      const harness = makeHarness({ alreadySent: true });

      const summary = await harness.service.run();

      expect(summary).toMatchObject({ sent: 0, alreadySent: 1 });
      expect(harness.sent).toEqual([]);
      expect(harness.store.spendByService).not.toHaveBeenCalled();
      expect(harness.store.recordSent).not.toHaveBeenCalled();
    });
  });

  describe("given one customer's statement fails", () => {
    it("still sends the others", async () => {
      const harness = makeHarness({
        accounts: [
          makeAccount({ id: "cba-bad", organizationId: "org-bad" }),
          makeAccount(),
        ],
      });
      harness.store.spendByService.mockImplementation(
        async ({ organizationId }: { organizationId: string }) => {
          if (organizationId === "org-bad") throw new Error("ledger down");
          return [{ service: "instant_evals", usdCents: 4_200 }];
        },
      );

      const summary = await harness.service.run();

      expect(summary).toMatchObject({ sent: 1, failed: 1 });
      expect(harness.sent).toHaveLength(1);
    });
  });
});
