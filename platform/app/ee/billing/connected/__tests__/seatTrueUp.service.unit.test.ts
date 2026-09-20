/**
 * The quarterly seat true-up of a connected self-hosted customer.
 *
 * Boundaries mocked: the store (the license registry, the seat reports and the
 * decision rows) and the invoicer (the payment provider).
 *
 * @see specs/self-hosting/connected-services/connected-billing.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectedSeatTrueUpService,
  closedTermQuarters,
  proratedSeatAmountCents,
  proratedSeatUnitAmountCents,
  type SeatQuarterPeak,
  type SeatTrueUpAccount,
  type SeatTrueUpLicense,
  type SeatTrueUpRecord,
  type SeatTrueUpStore,
} from "../seatTrueUp.service";

const LICENSE_ID = "lic-row-1";
const ORGANIZATION_ID = "org-acme";
const TERM_STARTS_AT = new Date("2026-01-01T00:00:00.000Z");
const TERM_ENDS_AT = new Date("2027-01-01T00:00:00.000Z");
/** The first quarter of the term closes here, and the second one opens. */
const SECOND_QUARTER = new Date("2026-04-01T00:00:00.000Z");
const THIRD_QUARTER = new Date("2026-07-01T00:00:00.000Z");
/** A day inside the second quarter, so the first one has closed. */
const NOW = new Date("2026-05-10T00:00:00.000Z");

/** 600 USD per seat per year. */
const SEAT_RATE_CENTS = 60_000;

function makeLicense(
  overrides: Partial<SeatTrueUpLicense> = {},
): SeatTrueUpLicense {
  return {
    id: LICENSE_ID,
    organizationId: ORGANIZATION_ID,
    issuedAt: TERM_STARTS_AT,
    maxMembers: 50,
    seatOverageAllowance: 10,
    lastSyncAt: new Date("2026-03-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeAccount(
  overrides: Partial<SeatTrueUpAccount> = {},
): SeatTrueUpAccount {
  return {
    id: "cba-1",
    stripeCustomerId: "cus_acme",
    seatCurrency: "USD",
    seatRateCents: SEAT_RATE_CENTS,
    seats: 50,
    termStartsAt: TERM_STARTS_AT,
    termEndsAt: TERM_ENDS_AT,
    bankTransfer: null,
    ...overrides,
  };
}

function invoicedDecision(
  overrides: Partial<SeatTrueUpRecord> = {},
): SeatTrueUpRecord {
  return {
    licenseId: LICENSE_ID,
    quarterStartsAt: TERM_STARTS_AT,
    peakSeats: 53,
    addedSeats: 3,
    amountCents: 135_615,
    currency: "USD",
    state: "invoiced",
    stripeInvoiceId: "in_first",
    ...overrides,
  };
}

interface Harness {
  service: ConnectedSeatTrueUpService;
  store: Record<keyof SeatTrueUpStore, ReturnType<typeof vi.fn>>;
  invoiceAddedSeats: ReturnType<typeof vi.fn>;
  recorded: SeatTrueUpRecord[];
  invoiceCalls: () => Array<Record<string, unknown>>;
}

function makeHarness({
  licenses = [makeLicense()],
  account = makeAccount(),
  peaks = new Map<string, SeatQuarterPeak>(),
  decisions = [] as SeatTrueUpRecord[],
  now = NOW,
}: {
  licenses?: SeatTrueUpLicense[];
  account?: SeatTrueUpAccount | null;
  peaks?: Map<string, SeatQuarterPeak>;
  decisions?: SeatTrueUpRecord[];
  now?: Date;
} = {}): Harness {
  const recorded: SeatTrueUpRecord[] = [];
  const store = {
    listLicenses: vi.fn(async () => licenses),
    findAccount: vi.fn(async () => account),
    findPeak: vi.fn(
      async ({ quarterStartsAt }: { quarterStartsAt: Date }) =>
        peaks.get(quarterStartsAt.toISOString()) ?? null,
    ),
    findDecisions: vi.fn(async () => decisions),
    record: vi.fn(async (record: SeatTrueUpRecord) => {
      recorded.push(record);
    }),
  };
  const invoiceAddedSeats = vi.fn(async (..._args: unknown[]) => ({
    invoiceId: "in_seat_1",
  }));

  return {
    service: new ConnectedSeatTrueUpService({
      store: store as unknown as SeatTrueUpStore,
      invoicer: { invoiceAddedSeats },
      now: () => now,
    }),
    store,
    invoiceAddedSeats,
    recorded,
    invoiceCalls: () =>
      invoiceAddedSeats.mock.calls.map(
        (call) => call[0] as Record<string, unknown>,
      ),
  };
}

function peakOf(quarter: Date, peakMembers: number): [string, SeatQuarterPeak] {
  return [
    quarter.toISOString(),
    { peakMembers, lastReportedAt: new Date(quarter.getTime() + 1_000) },
  ];
}

describe("ConnectedSeatTrueUpService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the worked example of the billing runbook", () => {
    // A term of 2026-10-01 to 2027-10-01, which is 365 days. 50 seats at
    // 600 USD per seat per year. Eight people join in month five, so the
    // quarter that closes on 2027-04-01 peaks at 58 and 183 days of the term
    // are still to run, counted from the day after it closes.
    const runbookTermStartsAt = new Date("2026-10-01T00:00:00.000Z");
    const runbookTermEndsAt = new Date("2027-10-01T00:00:00.000Z");
    const runbookSecondQuarter = new Date("2027-01-01T00:00:00.000Z");

    function runbookHarness(): Harness {
      return makeHarness({
        licenses: [makeLicense({ issuedAt: runbookTermStartsAt })],
        account: makeAccount({
          termStartsAt: runbookTermStartsAt,
          termEndsAt: runbookTermEndsAt,
        }),
        peaks: new Map([
          peakOf(runbookTermStartsAt, 50),
          peakOf(runbookSecondQuarter, 58),
        ]),
        now: new Date("2027-04-15T00:00:00.000Z"),
      });
    }

    /** @scenario "Seats added during a quarter are invoiced prorated to the end of the term" */
    it("charges 8 added seats at 300.82 USD each, 2406.56 USD in all", async () => {
      const harness = runbookHarness();

      await harness.service.run();

      expect(harness.invoiceCalls()).toHaveLength(1);
      expect(harness.invoiceCalls()[0]).toMatchObject({
        addedSeats: 8,
        unitAmountCents: 30_082,
        amountCents: 240_656,
        currency: "USD",
        stripeCustomerId: "cus_acme",
      });
    });

    /** @scenario "Seats added during a quarter are invoiced prorated to the end of the term" */
    it("rounds the seat to the cent before multiplying, as the invoice line reads", () => {
      // 600.00 x 183 / 365 = 300.8219, rounded to 300.82 per seat.
      expect(
        proratedSeatUnitAmountCents({
          seatRateCents: SEAT_RATE_CENTS,
          daysRemaining: 183,
          termDays: 365,
        }),
      ).toBe(30_082);
      expect(
        proratedSeatAmountCents({
          addedSeats: 8,
          seatRateCents: SEAT_RATE_CENTS,
          daysRemaining: 183,
          termDays: 365,
        }),
      ).toBe(240_656);
    });

    /** @scenario "Seats added during a quarter are invoiced prorated to the end of the term" */
    it("charges nothing for the days before the quarter closed", async () => {
      const harness = runbookHarness();

      await harness.service.run();

      // The quarter the seats were added in ran 2027-01-01 to 2027-04-01. A
      // charge covering those 90 days as well would be 8 x 448.77 USD.
      expect(harness.invoiceCalls()[0]!.amountCents).toBeLessThan(
        proratedSeatAmountCents({
          addedSeats: 8,
          seatRateCents: SEAT_RATE_CENTS,
          daysRemaining: 273,
          termDays: 365,
        }),
      );
      expect(harness.recorded.at(-1)).toMatchObject({
        quarterStartsAt: runbookSecondQuarter,
        peakSeats: 58,
        addedSeats: 8,
        amountCents: 240_656,
        state: "invoiced",
      });
    });
  });

  describe("given a quarter whose peak went above the seats already invoiced", () => {
    /** @scenario "The seat true-up is its own invoice in the currency of the seat contract" */
    it("invoices in the seat currency and leaves the usage subscription alone", async () => {
      const harness = makeHarness({
        account: makeAccount({ seatCurrency: "EUR" }),
        peaks: new Map([peakOf(TERM_STARTS_AT, 53)]),
      });

      await harness.service.run();

      expect(harness.invoiceCalls()[0]).toMatchObject({ currency: "EUR" });
      expect(harness.recorded.at(-1)?.currency).toBe("EUR");
    });

    /** @scenario "Seat invoices are never paid from the usage commit" */
    it("bills the seats on their own one-off invoice, which no credit can pay", async () => {
      const harness = makeHarness({
        peaks: new Map([peakOf(TERM_STARTS_AT, 53)]),
      });

      await harness.service.run();

      // A credit grant applies to metered subscription items only, so an
      // invoice naming no subscription can never draw the usage commit down.
      const call = harness.invoiceCalls()[0]!;
      expect(Object.keys(call)).not.toContain("subscription");
      expect(Object.keys(call)).not.toContain("subscriptionItem");
      expect(Object.keys(call)).not.toContain("creditGrantId");
    });
  });

  describe("given the current quarter has not closed", () => {
    /** @scenario "The true-up only runs for a quarter that has closed" */
    it("invoices nothing for it", async () => {
      const harness = makeHarness({
        peaks: new Map([peakOf(SECOND_QUARTER, 60)]),
      });

      await harness.service.run();

      expect(harness.store.findPeak).toHaveBeenCalledTimes(1);
      expect(harness.store.findPeak).toHaveBeenCalledWith({
        licenseId: LICENSE_ID,
        quarterStartsAt: TERM_STARTS_AT,
      });
      expect(harness.invoiceAddedSeats).not.toHaveBeenCalled();
    });

    /** @scenario "The true-up only runs for a quarter that has closed" */
    it("lists only the quarters that ended before now", () => {
      expect(
        closedTermQuarters({
          issuedAt: TERM_STARTS_AT,
          termEndsAt: TERM_ENDS_AT,
          now: NOW,
        }).map((quarter) => quarter.startsAt.toISOString()),
      ).toEqual([TERM_STARTS_AT.toISOString()]);
    });
  });

  describe("given an earlier quarter already invoiced added seats", () => {
    /** @scenario "Seats already invoiced are not invoiced again" */
    it("invoices only the seats above the ones already billed", async () => {
      const harness = makeHarness({
        now: new Date("2026-08-10T00:00:00.000Z"),
        peaks: new Map([
          peakOf(TERM_STARTS_AT, 53),
          peakOf(SECOND_QUARTER, 54),
        ]),
        decisions: [invoicedDecision()],
      });

      await harness.service.run();

      expect(harness.invoiceCalls()).toHaveLength(1);
      expect(harness.invoiceCalls()[0]).toMatchObject({ addedSeats: 1 });
    });

    /** @scenario "Seats that went down are not credited back mid-term" */
    it("creates no invoice and no credit when the peak fell back", async () => {
      const harness = makeHarness({
        now: new Date("2026-08-10T00:00:00.000Z"),
        peaks: new Map([
          peakOf(TERM_STARTS_AT, 53),
          peakOf(SECOND_QUARTER, 51),
        ]),
        decisions: [invoicedDecision()],
      });

      await harness.service.run();

      expect(harness.invoiceAddedSeats).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([
        expect.objectContaining({
          quarterStartsAt: SECOND_QUARTER,
          addedSeats: 0,
          amountCents: 0,
          state: "nothing_to_invoice",
        }),
      ]);
    });
  });

  describe("given a quarter whose peak matches the seats licensed", () => {
    /** @scenario "A quarter with no added seats creates nothing" */
    it("records the quarter as done without invoicing", async () => {
      const harness = makeHarness({
        peaks: new Map([peakOf(TERM_STARTS_AT, 50)]),
      });

      await harness.service.run();

      expect(harness.invoiceAddedSeats).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([
        expect.objectContaining({
          quarterStartsAt: TERM_STARTS_AT,
          peakSeats: 50,
          addedSeats: 0,
          state: "nothing_to_invoice",
        }),
      ]);
    });
  });

  describe("given the quarter was already decided", () => {
    /** @scenario "Running the true-up twice for one quarter invoices once" */
    it("leaves the decision alone on a second run", async () => {
      const harness = makeHarness({
        peaks: new Map([peakOf(TERM_STARTS_AT, 53)]),
        decisions: [invoicedDecision()],
      });

      await harness.service.run();

      expect(harness.invoiceAddedSeats).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([]);
    });
  });

  describe("given the payment provider failed after the intent was recorded", () => {
    const stuckIntent = invoicedDecision({
      state: "intent",
      stripeInvoiceId: null,
    });

    /** @scenario "A true-up that failed at the payment provider is retried without doubling" */
    it("retries under the key the first attempt used, so one invoice exists", async () => {
      const harness = makeHarness({
        peaks: new Map([peakOf(TERM_STARTS_AT, 53)]),
        decisions: [stuckIntent],
      });

      await harness.service.run();

      expect(harness.invoiceCalls()).toHaveLength(1);
      expect(harness.invoiceCalls()[0]!.idempotencyKey).toBe(
        `connected-seat-true-up:${LICENSE_ID}:${TERM_STARTS_AT.toISOString()}`,
      );
      expect(harness.recorded.at(-1)).toMatchObject({
        state: "invoiced",
        stripeInvoiceId: "in_seat_1",
        addedSeats: 3,
      });
    });

    /** @scenario "A true-up that failed at the payment provider is retried without doubling" */
    it("does not count the stuck quarter's own seats as already invoiced", async () => {
      const harness = makeHarness({
        peaks: new Map([peakOf(TERM_STARTS_AT, 53)]),
        decisions: [stuckIntent],
      });

      await harness.service.run();

      expect(harness.invoiceCalls()[0]).toMatchObject({ addedSeats: 3 });
    });
  });

  describe("given a license that did not sync during the quarter", () => {
    /** @scenario "A customer that never synced is flagged, not invoiced on a guess" */
    it("flags it for follow-up instead of inventing a peak", async () => {
      const harness = makeHarness({ peaks: new Map() });

      await harness.service.run();

      expect(harness.invoiceAddedSeats).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([
        expect.objectContaining({
          licenseId: LICENSE_ID,
          quarterStartsAt: TERM_STARTS_AT,
          addedSeats: 0,
          amountCents: 0,
          state: "flagged",
        }),
      ]);
    });

    /** @scenario "An air-gapped license is left to the annual true-up" */
    it("skips a license with no seat allowance that never synced", async () => {
      const harness = makeHarness({
        licenses: [makeLicense({ seatOverageAllowance: 0, lastSyncAt: null })],
        peaks: new Map(),
      });

      await harness.service.run();

      expect(harness.invoiceAddedSeats).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([
        expect.objectContaining({ state: "skipped" }),
      ]);
    });
  });

  describe("given several quarters of the term have closed", () => {
    /** @scenario "Seats added during a quarter are invoiced prorated to the end of the term" */
    it("charges each quarter over the days that were left when it closed", async () => {
      const harness = makeHarness({
        now: new Date("2026-11-10T00:00:00.000Z"),
        peaks: new Map([
          peakOf(TERM_STARTS_AT, 51),
          peakOf(SECOND_QUARTER, 52),
          peakOf(THIRD_QUARTER, 53),
        ]),
      });
      harness.invoiceAddedSeats.mockImplementation(async () => ({
        invoiceId: `in_${harness.invoiceAddedSeats.mock.calls.length}`,
      }));

      await harness.service.run();

      const amounts = harness
        .invoiceCalls()
        .map((call) => call.amountCents as number);
      // 275, 184 and 92 days remain when the three quarters close, so the
      // seat added in each one costs less than the one before it.
      expect(amounts).toHaveLength(3);
      expect(amounts[0]).toBeGreaterThan(amounts[1]!);
      expect(amounts[1]).toBeGreaterThan(amounts[2]!);
    });
  });

  describe("given an organization that was never onboarded for billing", () => {
    it("decides nothing for its licenses", async () => {
      const harness = makeHarness({ account: null });

      await harness.service.run();

      expect(harness.store.findPeak).not.toHaveBeenCalled();
      expect(harness.recorded).toEqual([]);
    });
  });
});
