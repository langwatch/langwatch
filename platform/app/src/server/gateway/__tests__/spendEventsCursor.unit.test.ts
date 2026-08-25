import { describe, expect, it } from "vitest";
import {
  END_USER_SPEND_DESCRIPTION,
  SPEND_EVENTS_PULL_DESCRIPTION,
  SPEND_SUMMARIES_DESCRIPTION,
} from "../../../app/api/gateway-spend/[[...route]]/contract";
import {
  decodeSpendEventsCursor,
  decodeSpendSummariesCursor,
  encodeSpendEventsCursor,
  encodeSpendSummariesCursor,
} from "../spendEvents.clickhouse.repository";

describe("Feature: Gateway spend reconciliation REST surface", () => {
  describe("given a page cursor", () => {
    describe("when it is encoded and read back", () => {
      /** @scenario Cursor encoding round-trips every version and id pair */
      it("round-trips version and id pairs and rejects garbage", () => {
        const pairs = [
          { eventTimestampMs: 0, gatewayRequestId: "a" },
          { eventTimestampMs: 1753791000000, gatewayRequestId: "01J1QA7Z3D" },
          {
            eventTimestampMs: Number.MAX_SAFE_INTEGER,
            gatewayRequestId: "id:with:colons",
          },
        ];
        for (const pair of pairs) {
          const decoded = decodeSpendEventsCursor(encodeSpendEventsCursor(pair));
          expect(decoded).toEqual(pair);
        }

        expect(decodeSpendEventsCursor("")).toBeNull();
        expect(decodeSpendEventsCursor("%garbage%")).toBeNull();
        expect(
          decodeSpendEventsCursor(Buffer.from(":no-ts", "utf8").toString("base64url")),
        ).toBeNull();
        expect(
          decodeSpendEventsCursor(Buffer.from("NaN:id", "utf8").toString("base64url")),
        ).toBeNull();
        expect(
          decodeSpendEventsCursor(Buffer.from("123:", "utf8").toString("base64url")),
        ).toBeNull();
      });

      it("reads a one-part group key that opens with a bracket", () => {
        // Group keys are caller data, so a model or end-user id may legitimately
        // start with `[`. Deciding the format by looking at the first character
        // refused those callers' perfectly good cursors and restarted their walk
        // from page one, which double-counts.
        const legacy = Buffer.from("[beta]-model", "utf8").toString("base64url");
        expect(decodeSpendSummariesCursor(legacy)).toEqual(["[beta]-model"]);

        // The multi-part form still round-trips, including keys holding the
        // separator any joined encoding would have needed.
        for (const parts of [["gpt-5-mini"], ["a,b", "c:d"], ["[x]", "]y["]]) {
          expect(decodeSpendSummariesCursor(encodeSpendSummariesCursor(parts))).toEqual(
            parts,
          );
        }

        expect(decodeSpendSummariesCursor("")).toBeNull();
      });
    });
  });

  describe("given the published route contract", () => {
    describe("when a caller reads it", () => {
      /** @scenario The response documents the retention window and dedup guidance */
      it("pins the retention window and dedup guidance in the route contract", () => {
        expect(SPEND_EVENTS_PULL_DESCRIPTION).toContain("13 months");
        expect(SPEND_EVENTS_PULL_DESCRIPTION).toContain("Metronome 34 days");
        expect(SPEND_EVENTS_PULL_DESCRIPTION).toContain("Stripe meters 24h+");
        // Named exactly, because the response field is `caps` and a substring
        // assertion on "cap" passed happily while the prose described a nullable
        // singular field the schema has never had.
        expect(END_USER_SPEND_DESCRIPTION).toContain("`caps`");
        expect(END_USER_SPEND_DESCRIPTION).toContain("empty array");
      });

      it("tells a caller how to page and when a grouping is refused", () => {
        // The refusal is the one thing a reconciliation script cannot discover by
        // trying: it only fires on recent windows, so a script written and tested
        // against last month's data meets it first in production.
        expect(SPEND_SUMMARIES_DESCRIPTION).toContain("gateway_spend_group_by_unstable");
        expect(SPEND_SUMMARIES_DESCRIPTION).toContain("allow_unstable");
        // Named exactly, because `key` keeping its single-dimension meaning is
        // what stops an existing consumer silently reading one of two dimensions.
        expect(SPEND_SUMMARIES_DESCRIPTION).toContain("`group`");
      });
    });
  });
});
