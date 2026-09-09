// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the source badge says when configuration and health disagree, and when
 * the "no data since" line appears under it.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * Decision: ADR-128.
 *
 * The load-bearing case is a DISABLED source that is also failing. Both facts
 * are true and the badge can only say one of them, so the order of the two
 * checks is the whole behaviour — and it is invisible in the function until
 * something asserts it.
 */

import { UNHEALTHY_AFTER_CONSECUTIVE_FAILURES } from "@ee/governance/services/pullers/sourceHealth";
import { describe, expect, it } from "vitest";
import {
  noDataSinceNotice,
  SOURCE_STATUS_META,
  SOURCE_UNHEALTHY_META,
  sourceBadge,
} from "../sourceHealthDisplay";

/** Enough consecutive failures to be called unhealthy, whatever the cutoff is. */
const FAILING = UNHEALTHY_AFTER_CONSECUTIVE_FAILURES;

describe("sourceBadge", () => {
  describe("given a source an admin disabled", () => {
    describe("when its last runs all failed", () => {
      it("says disabled", () => {
        // A disabled source is not expected to be pulling, so "Not pulling" is
        // not news about it — it is the configured state, restated in red.
        expect(
          sourceBadge({ status: "disabled", errorCount: FAILING }),
        ).toEqual(SOURCE_STATUS_META.disabled);
      });
    });

    describe("when it is not failing either", () => {
      it("says disabled", () => {
        expect(sourceBadge({ status: "disabled", errorCount: 0 })).toEqual(
          SOURCE_STATUS_META.disabled,
        );
      });
    });
  });

  describe("given a source an admin left active", () => {
    describe("when it has failed enough times in a row", () => {
      it("says not pulling", () => {
        expect(sourceBadge({ status: "active", errorCount: FAILING })).toEqual(
          SOURCE_UNHEALTHY_META,
        );
      });
    });

    describe("when its failures are still below the cutoff", () => {
      it("still says active", () => {
        expect(
          sourceBadge({ status: "active", errorCount: FAILING - 1 }),
        ).toEqual(SOURCE_STATUS_META.active);
      });
    });
  });

  describe("given a status the badge has no entry for", () => {
    describe("when the badge is asked for it", () => {
      it("falls back to awaiting first event rather than rendering nothing", () => {
        expect(sourceBadge({ status: "something_new", errorCount: 0 })).toEqual(
          SOURCE_STATUS_META.awaiting_first_event,
        );
      });
    });
  });
});

describe("noDataSinceNotice", () => {
  const lastSuccessAt = new Date("2026-08-01T10:00:00.000Z");

  describe("given an active source that has failed enough times in a row", () => {
    describe("when it pulled successfully at some point before", () => {
      it("names the last success", () => {
        expect(
          noDataSinceNotice({
            status: "active",
            errorCount: FAILING,
            lastSuccessAt,
          }),
        ).toEqual({
          lastSuccessIso: "2026-08-01T10:00:00.000Z",
        });
      });
    });

    describe("when that timestamp arrives as a string, the shape the API returns", () => {
      it("names the last success just the same", () => {
        expect(
          noDataSinceNotice({
            status: "active",
            errorCount: FAILING,
            lastSuccessAt: "2026-08-01T10:00:00.000Z",
          }),
        ).toEqual({ lastSuccessIso: "2026-08-01T10:00:00.000Z" });
      });
    });

    describe("when it has never pulled successfully", () => {
      it("stays silent", () => {
        // There is no "since" to name, and the awaiting-first-event badge
        // already covers this case.
        expect(
          noDataSinceNotice({
            status: "active",
            errorCount: FAILING,
            lastSuccessAt: null,
          }),
        ).toBeNull();
      });
    });
  });

  describe("given an active source that is healthy", () => {
    describe("when it has a last success to name", () => {
      it("stays silent anyway", () => {
        expect(
          noDataSinceNotice({ status: "active", errorCount: 0, lastSuccessAt }),
        ).toBeNull();
      });
    });
  });

  describe("given a source an admin disabled", () => {
    describe("when its last runs all failed", () => {
      it("stays silent", () => {
        // Both facts are true and only one line can be shown. A source nobody
        // asked to run has not "stopped pulling", and the badge already says
        // Disabled — an outage notice under it sends the reader to fix
        // nothing.
        expect(
          noDataSinceNotice({
            status: "disabled",
            errorCount: FAILING,
            lastSuccessAt,
          }),
        ).toBeNull();
      });
    });
  });
});
