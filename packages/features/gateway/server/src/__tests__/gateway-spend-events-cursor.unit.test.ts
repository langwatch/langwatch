import { describe, expect, it } from "vitest";
import {
  decodeSpendEventsCursor,
  decodeSpendSummariesCursor,
  encodeSpendEventsCursor,
  encodeSpendSummariesCursor,
} from "@langwatch/gateway-server";

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
});
