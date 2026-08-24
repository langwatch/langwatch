// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The report kind is fixed once a source has pulled, and this is the half of
 * that rule a caller cannot walk around.
 *
 * The Anthropic adapter offers two reports for the same consumption: usage,
 * priced by our own rate card, and cost, which is Anthropic's own figure. Its
 * header states the invariant as "Never both" — a source picks one and its
 * events carry that choice in their ids, `usage:*` or `cost:*`.
 *
 * Editing the report is what breaks it, and it breaks quietly. The adapter
 * derives a query identity from the report, so a changed report stops matching
 * the stored cursor; the cursor is dropped, the new report replays from the
 * backfill start, and its events land in a namespace the old ones never
 * occupied. Nothing collides, nothing is overwritten, and nothing complains —
 * the two sets simply coexist, both counting the same money.
 *
 * The edit drawer declines to offer the change, but that is a courtesy paid to
 * whoever uses the form. This guard is what holds for a caller that does not.
 *
 * Spec: specs/governance/edit-pull-source-config.feature
 */

import { assertReportUnchangedOncePulled } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { describe, expect, it } from "vitest";
import type { Prisma } from "~/generated/prisma/client";

const sourceWith = ({
  report,
  pollerCursor,
}: {
  report?: string;
  pollerCursor: Prisma.JsonValue | null;
}) => ({
  parserConfig: (report === undefined
    ? { credentials: "sealed" }
    : { report, credentials: "sealed" }) as Prisma.JsonValue,
  pollerCursor,
});

describe("assertReportUnchangedOncePulled", () => {
  describe("given a source that has already pulled", () => {
    it("refuses a usage source being switched to cost", () => {
      expect(() =>
        assertReportUnchangedOncePulled({
          existing: sourceWith({
            report: "usage",
            pollerCursor: '{"startingAt":"2026-08-01T00:00:00Z"}',
          }),
          incoming: { report: "cost" },
        }),
      ).toThrow(/already pulled its usage report/);
    });

    it("refuses the reverse switch just as firmly", () => {
      // cost -> usage double-counts the same window as readily as the other
      // direction; neither is the safe one.
      expect(() =>
        assertReportUnchangedOncePulled({
          existing: sourceWith({
            report: "cost",
            pollerCursor: '{"startingAt":"2026-08-01T00:00:00Z"}',
          }),
          incoming: { report: "usage" },
        }),
      ).toThrow(/already pulled its cost report/);
    });

    it("carries the complaint in meta, where the client can render it", () => {
      // Message prose is not the contract — `meta.formErrors` is, and it is
      // the only channel that reaches whatever renders the refusal.
      try {
        assertReportUnchangedOncePulled({
          existing: sourceWith({ report: "usage", pollerCursor: "abc" }),
          incoming: { report: "cost" },
        });
        expect.unreachable("expected the guard to refuse");
      } catch (error) {
        expect(
          (error as { meta?: { formErrors?: string[] } }).meta?.formErrors,
        ).toHaveLength(1);
      }
    });

    it("allows an edit that leaves the report alone", () => {
      // The common edit: a renamed source, a moved cadence, a rotated key.
      expect(() =>
        assertReportUnchangedOncePulled({
          existing: sourceWith({ report: "usage", pollerCursor: "abc" }),
          incoming: { report: "usage", bucketWidth: "1h" },
        }),
      ).not.toThrow();
    });
  });

  describe("given a source that has not pulled yet", () => {
    it("allows the report to change", () => {
      // Nothing has been recorded under the old report, so there is nothing
      // for the new one to be counted beside.
      expect(() =>
        assertReportUnchangedOncePulled({
          existing: sourceWith({ report: "usage", pollerCursor: null }),
          incoming: { report: "cost" },
        }),
      ).not.toThrow();
    });

    it("treats a serialised empty cursor as not having pulled", () => {
      // Same reading the DTO takes, and for the same reason: "{}" is how an
      // empty object arrives after a round trip through `cursorOf`.
      expect(() =>
        assertReportUnchangedOncePulled({
          existing: sourceWith({ report: "usage", pollerCursor: "{}" }),
          incoming: { report: "cost" },
        }),
      ).not.toThrow();
    });
  });

  describe("given a source whose stored config names no report", () => {
    it("does not invent an immutability it cannot justify", () => {
      // A push-mode source, or an adapter with no report axis at all. Claiming
      // the field is locked would send an admin to archive-and-recreate over
      // something that was never fixed.
      expect(() =>
        assertReportUnchangedOncePulled({
          existing: sourceWith({ pollerCursor: "abc" }),
          incoming: { report: "cost" },
        }),
      ).not.toThrow();
    });
  });
});
