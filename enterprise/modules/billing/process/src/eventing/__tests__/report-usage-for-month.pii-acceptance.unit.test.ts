/**
 * PII redaction usage is billed from the later of its price line and the organization's acceptance,
 * and a month the acceptance narrows never reports below what it sent (ADR-201 decision 15).
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */
import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { describe, expect, it } from "vitest";

import { PII_REDACTION_USD_EVENT_NAME } from "../../rules/pii-redaction-meter.rules.ts";
import {
  BILLING_MONTH,
  billing,
  lineSince,
  ON_THE_10TH_MS,
  ON_THE_3RD_MS,
  ORG,
  SPEND_ON_THE_5TH_AND_20TH,
} from "./report-usage-for-month.line-date.fixture.ts";

const LINE_BEFORE_THE_MONTH = lineSince(Date.UTC(2026, 0, 20));
const at = {
  organizationId: ORG,
  billingMonth: BILLING_MONTH,
  meter: PII_REDACTION_USD_EVENT_NAME,
};

describe("billing PII redaction usage from the organization's acceptance", () => {
  describe("given a PII redaction line and an acceptance on different days, spend on the 5th and 20th", () => {
    /** @scenario "The PII redaction month starts at the later of its price line and the acceptance" */
    it.each([
      {
        order: "line on the 3rd, acceptance on the 10th",
        lineAtMs: ON_THE_3RD_MS,
        acceptedAtMs: ON_THE_10TH_MS,
      },
      {
        order: "acceptance on the 3rd, line on the 10th",
        lineAtMs: ON_THE_10TH_MS,
        acceptedAtMs: ON_THE_3RD_MS,
      },
    ])("bills only the 20th's spend, $order", async ({ lineAtMs, acceptedAtMs }) => {
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_PII_REDACTION_USD: lineSince(lineAtMs) },
        piiAcceptedAtMs: acceptedAtMs,
      });

      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(PII_REDACTION_REQUEST_TYPE)[0]?.fromMs).toBe(ON_THE_10TH_MS);
    });
  });

  describe("given a PII redaction line since before the month and no acceptance", () => {
    /** @scenario "An organization that never accepted the price reports no PII redaction spend" */
    it("sends nothing and never reads the PII redaction ledger", async () => {
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_PII_REDACTION_USD: LINE_BEFORE_THE_MONTH },
        piiAcceptedAtMs: null,
      });

      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([]);
      expect(report.readsOf(PII_REDACTION_REQUEST_TYPE)).toEqual([]);
    });
  });

  describe("given 3 dollars of PII redaction already reported for the whole month", () => {
    /** @scenario "A month the acceptance narrows never reports below what it already sent" */
    it.each([
      { acceptance: "an acceptance on the 10th", acceptedAtMs: ON_THE_10TH_MS },
      { acceptance: "no acceptance", acceptedAtMs: null },
    ])(
      "sends no negative delta and keeps the checkpoint, with $acceptance",
      async ({ acceptedAtMs }) => {
        const report = billing({
          ledger: SPEND_ON_THE_5TH_AND_20TH,
          lines: { GROWTH_PII_REDACTION_USD: LINE_BEFORE_THE_MONTH },
          piiAcceptedAtMs: acceptedAtMs,
        });
        await report.checkpoints.confirm({ ...at, lastReportedTotal: 30_000 });

        await report.report();

        expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([]);
        expect(await report.checkpoints.findCheckpoint(at)).toMatchObject({
          lastReportedTotal: 30_000,
        });
      },
    );
  });
});
