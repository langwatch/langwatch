/**
 * Instant Evals and PII redaction usage is billed only from the moment its price line was added
 * (ADR-174 decision 26), over the real spend reads and a ledger dated row by row.
 * @see enterprise/modules/billing/specs/usage-billed-from-line-date.feature
 */
import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import type { BillingSubscription } from "../../rules/billing-stripe-shapes.rules.ts";
import { INSTANT_EVAL_USD_EVENT_NAME } from "../../rules/instant-eval-meter.rules.ts";
import { PII_REDACTION_USD_EVENT_NAME } from "../../rules/pii-redaction-meter.rules.ts";
import {
  BILLING_MONTH,
  billing,
  instantEvalSubscription,
  type LedgerRow,
  lineSince,
  lookup,
  MONTH_START_MS,
  ON_THE_10TH_MS,
  ON_THE_12TH_MS,
  ON_THE_20TH_MS,
  ON_THE_3RD_MS,
  ONE_DOLLAR_NANO_USD,
  ORG,
  SPEND_ON_THE_5TH_AND_20TH,
} from "./report-usage-for-month.line-date.fixture.ts";

describe("billing usage from the moment its price line was added", () => {
  describe("given usage held for want of the Instant Evals line, which is added on the 12th", () => {
    /** @scenario "Usage before the price line was added is never billed" */
    it("bills only the spend since the line, never the 5th's", async () => {
      const report = billing({ ledger: SPEND_ON_THE_5TH_AND_20TH, lines: {} });

      await report.report();
      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([]);

      report.lines.GROWTH_INSTANT_EVAL_USD = lineSince(ON_THE_12TH_MS);
      await report.report();
      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE).at(-1)?.fromMs).toBe(ON_THE_12TH_MS);
    });
  });

  describe("given usage held for want of the PII redaction line, which is added on the 12th", () => {
    /** @scenario "Usage before the price line was added is never billed" */
    it("bills only the PII redaction spend since the line, never the month from its first day", async () => {
      const report = billing({ ledger: SPEND_ON_THE_5TH_AND_20TH, lines: {} });

      await report.report();
      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([]);

      report.lines.GROWTH_PII_REDACTION_USD = lineSince(ON_THE_12TH_MS);
      await report.report();
      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(PII_REDACTION_REQUEST_TYPE).at(-1)?.fromMs).toBe(ON_THE_12TH_MS);
    });
  });

  describe("given a subscription that has carried the Instant Evals line since before the month", () => {
    /** @scenario "Usage after the price line was added is billed" */
    it("bills the whole month's spend", async () => {
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_INSTANT_EVAL_USD: lineSince(Date.UTC(2026, 0, 15)) },
      });

      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([3]);
      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(MONTH_START_MS);
    });
  });

  describe("given a subscription that gained the PII redaction line on the 10th", () => {
    /** @scenario "A PII redaction line added mid-month bills only from that moment" */
    it("bills only the PII redaction spend since the 10th", async () => {
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_PII_REDACTION_USD: lineSince(ON_THE_10TH_MS) },
      });

      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(PII_REDACTION_REQUEST_TYPE)[0]?.fromMs).toBe(ON_THE_10TH_MS);
    });
  });

  describe("given a growth-seat subscription from the 3rd whose Instant Evals line came on the 10th", () => {
    /** @scenario "The month starts at the later of the subscription's start and the line's" */
    it("reads the spend from the 10th", async () => {
      const report = billing({
        organization: lookup({ seatStartMs: ON_THE_3RD_MS }),
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_INSTANT_EVAL_USD: lineSince(ON_THE_10TH_MS) },
      });

      await report.report();

      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(ON_THE_10TH_MS);
      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([2]);
    });
  });

  describe("given a PII redaction checkpoint at 1.5000 dollars and a line from the 10th", () => {
    /** @scenario "A month already reported is not lowered when the line's start narrows it" */
    it("sends nothing and keeps the checkpoint, then bills spend past it", async () => {
      const ledger: LedgerRow[] = [
        { requestType: PII_REDACTION_REQUEST_TYPE, atMs: ON_THE_12TH_MS, nanoUsd: 500_000_000 },
      ];
      const report = billing({
        ledger,
        lines: { GROWTH_PII_REDACTION_USD: lineSince(ON_THE_10TH_MS) },
      });
      const at = {
        organizationId: ORG,
        billingMonth: BILLING_MONTH,
        meter: PII_REDACTION_USD_EVENT_NAME,
      };
      await report.checkpoints.confirm({ ...at, lastReportedTotal: 15_000 });

      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([]);
      expect(await report.checkpoints.findCheckpoint(at)).toMatchObject({
        lastReportedTotal: 15_000,
      });

      ledger.push({
        requestType: PII_REDACTION_REQUEST_TYPE,
        atMs: ON_THE_20TH_MS,
        nanoUsd: 1_500_000_000,
      });
      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([0.5]);
    });
  });

  describe("given an Instant Evals line that ended on the 6th and a new one on another subscription from the 15th", () => {
    /** @scenario "Usage while no line existed anywhere is never billed" */
    it("never bills the 10th's spend, when no line existed anywhere", async () => {
      const report = billing({
        ledger: [
          {
            requestType: INSTANT_EVAL_REQUEST_TYPE,
            atMs: Date.UTC(2026, 1, 3, 9),
            nanoUsd: ONE_DOLLAR_NANO_USD,
          },
          {
            requestType: INSTANT_EVAL_REQUEST_TYPE,
            atMs: ON_THE_10TH_MS,
            nanoUsd: 4 * ONE_DOLLAR_NANO_USD,
          },
          {
            requestType: INSTANT_EVAL_REQUEST_TYPE,
            atMs: ON_THE_20TH_MS,
            nanoUsd: 2 * ONE_DOLLAR_NANO_USD,
          },
        ],
        lines: {},
        stripe: [
          instantEvalSubscription({
            lineAtMs: Date.UTC(2026, 0, 15),
            endedAtMs: Date.UTC(2026, 1, 6, 10),
          }),
          instantEvalSubscription({ lineAtMs: Date.UTC(2026, 1, 15, 12) }),
        ],
      });

      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(Date.UTC(2026, 1, 15, 12));
    });
  });

  describe("given an Instant Evals line Stripe answered with no creation time", () => {
    /** @scenario "A line with no recorded creation is refused as a failed read" */
    it("sends nothing and counts a failed read toward the breaker", async () => {
      const live = instantEvalSubscription({ lineAtMs: ON_THE_12TH_MS });
      const unknownCreation: BillingSubscription = {
        ...live,
        items: live.items.map((item) => ({ ...item, createdAt: Number.NaN })),
      };
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: {},
        stripe: [unknownCreation],
      });

      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([]);
      expect(
        await report.checkpoints.findCheckpoint({
          organizationId: ORG,
          billingMonth: BILLING_MONTH,
          meter: INSTANT_EVAL_USD_EVENT_NAME,
        }),
      ).toMatchObject({ lastReportedTotal: 0, pendingReportedTotal: null, consecutiveFailures: 1 });
    });
  });

  describe("given a connected account", () => {
    /** @scenario "A connected customer's hosted usage keeps the whole month" */
    it("reads its Instant Evals spend from the month's start", async () => {
      const report = billing({
        organization: lookup({ contract: "connected" }),
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: {},
      });

      await report.report();

      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(MONTH_START_MS);
      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([3]);
    });
  });
});
