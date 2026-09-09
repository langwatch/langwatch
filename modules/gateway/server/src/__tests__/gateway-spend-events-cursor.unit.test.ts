import { describe, expect, it } from "vitest";
import { GatewaySpendCursorAdapter } from "@langwatch/gateway-server";

const spendCursors = GatewaySpendCursorAdapter.create();
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
          const decoded = spendCursors.decodeSpendEventsCursor(
            spendCursors.encodeSpendEventsCursor(pair),
          );
          expect(decoded).toEqual(pair);
        }

        expect(spendCursors.decodeSpendEventsCursor("")).toBeNull();
        expect(spendCursors.decodeSpendEventsCursor("%garbage%")).toBeNull();
        expect(
          spendCursors.decodeSpendEventsCursor(Buffer.from(":no-ts", "utf8").toString("base64url")),
        ).toBeNull();
        expect(
          spendCursors.decodeSpendEventsCursor(Buffer.from("NaN:id", "utf8").toString("base64url")),
        ).toBeNull();
        expect(
          spendCursors.decodeSpendEventsCursor(Buffer.from("123:", "utf8").toString("base64url")),
        ).toBeNull();
      });

      it("reads a one-part group key that opens with a bracket", () => {
        // Group keys are caller data, so a model or end-user id may legitimately
        // start with `[`. Deciding the format by looking at the first character
        // refused those callers' perfectly good cursors and restarted their walk
        // from page one, which double-counts.
        const legacy = Buffer.from("[beta]-model", "utf8").toString("base64url");
        expect(spendCursors.decodeSpendSummariesCursor(legacy)).toEqual(["[beta]-model"]);

        // The multi-part form still round-trips, including keys holding the
        // separator any joined encoding would have needed.
        for (const parts of [["gpt-5-mini"], ["a,b", "c:d"], ["[x]", "]y["]]) {
          expect(
            spendCursors.decodeSpendSummariesCursor(spendCursors.encodeSpendSummariesCursor(parts)),
          ).toEqual(parts);
        }

        expect(spendCursors.decodeSpendSummariesCursor("")).toBeNull();
      });
    });
  });
});
