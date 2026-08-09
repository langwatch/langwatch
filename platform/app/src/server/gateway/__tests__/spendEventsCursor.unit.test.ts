import { describe, expect, it } from "vitest";
import {
  END_USER_SPEND_DESCRIPTION,
  SPEND_EVENTS_PULL_DESCRIPTION,
} from "../../../app/api/gateway-spend/[[...route]]/contract";
import {
  decodeSpendEventsCursor,
  encodeSpendEventsCursor,
} from "../spendEvents.clickhouse.repository";

describe("Feature: Gateway spend reconciliation REST surface", () => {
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
      decodeSpendEventsCursor(
        Buffer.from(":no-ts", "utf8").toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeSpendEventsCursor(
        Buffer.from("NaN:id", "utf8").toString("base64url"),
      ),
    ).toBeNull();
    expect(
      decodeSpendEventsCursor(
        Buffer.from("123:", "utf8").toString("base64url"),
      ),
    ).toBeNull();
  });

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
});
