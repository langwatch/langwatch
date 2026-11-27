import { describe, expect, it } from "vitest";

import { Instance } from "../instance.ts";
import { Ksuid } from "../ksuid.ts";
import type { KsuidLayout } from "../types.ts";

const zeroInstance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8));

function encode({
  timestamp,
  sequenceId = 0,
  layout,
}: {
  timestamp: number;
  sequenceId?: number;
  layout?: KsuidLayout;
}): string {
  return new Ksuid({
    environment: "prod",
    resource: "user",
    timestamp,
    instance: zeroInstance,
    sequenceId,
    layout,
  }).toString();
}

// 1700003840 is 0x65540000: its low 16 bits are zero, so it is a 65,536-second boundary.
const BEFORE_BOUNDARY = 1700003839;
const AT_BOUNDARY = 1700003840;

describe("Ksuid byte layout", () => {
  /** @scenario "Generated identifiers sort by creation time across 65,536-second boundaries" */
  it("sorts an id generated one second later after the earlier one", () => {
    const older = encode({ timestamp: BEFORE_BOUNDARY });
    const newer = encode({ timestamp: AT_BOUNDARY });

    expect(older < newer).toBe(true);
  });

  /** @scenario "The TypeScript and Python packages encode the same identifier" */
  it.each([
    { timestamp: BEFORE_BOUNDARY, sequenceId: 0, expected: "user_000000CjU4xZOW5fg8JiC424Gryym" },
    { timestamp: AT_BOUNDARY, sequenceId: 0, expected: "user_000000CjU4xgFyEUdJTrg9rN0qHZ2" },
    {
      timestamp: BEFORE_BOUNDARY,
      sequenceId: 0x80000000,
      expected: "user_000000CjU4xZOW5fg8JiC426cCbZo",
    },
    {
      timestamp: 2 ** 32 + 0x1234,
      sequenceId: 0xffffffff,
      expected: "user_000000WAanSZOgvkWln2b9zOTwB0J",
    },
    {
      timestamp: 2 ** 48 - 2,
      sequenceId: 0xffffffff,
      expected: "user_0008qTbOZmgPiXlaRbfrBi7rbIfAF",
    },
  ])(
    "encodes timestamp $timestamp and sequence $sequenceId as langwatch-ksuid does",
    ({ timestamp, sequenceId, expected }) => {
      expect(encode({ timestamp, sequenceId })).toBe(expected);

      const parsed = Ksuid.parse(expected);
      expect(parsed.timestamp).toBe(timestamp);
      expect(parsed.sequenceId).toBe(sequenceId);
      expect(parsed.layout).toBe("v2");
    },
  );

  /** @scenario "Identifiers in the legacy layout keep their string and their time" */
  it.each([
    { timestamp: BEFORE_BOUNDARY, sequenceId: 0, expected: "user_0008qTHxTCVP6UGxYPdlenlmENvVo" },
    {
      timestamp: BEFORE_BOUNDARY,
      sequenceId: 0x7fffffff,
      expected: "user_0008qTHxTCVP6UGxYPdlenloZiY6p",
    },
    { timestamp: 1234567890, sequenceId: 42, expected: "user_000062maHuplKta5dbf0VUBJ4PDfm" },
  ])(
    "writes and re-reads the 2.0.2 string for timestamp $timestamp",
    ({ timestamp, sequenceId, expected }) => {
      expect(encode({ timestamp, sequenceId, layout: "v1-legacy" })).toBe(expected);

      const parsed = Ksuid.parse(expected);
      expect(parsed.timestamp).toBe(timestamp);
      expect(parsed.sequenceId).toBe(sequenceId);
      expect(parsed.layout).toBe("v1-legacy");
      expect(parsed.toString()).toBe(expected);
    },
  );

  it("writes the same string in both layouts when the low 16 bits are zero", () => {
    expect(encode({ timestamp: AT_BOUNDARY, layout: "v1-legacy" })).toBe(
      encode({ timestamp: AT_BOUNDARY }),
    );
  });

  it("reads a v2 id as legacy when its high and low 16 bits match, which needs a year past 2106", () => {
    const parsed = Ksuid.parse("user_0008qTbOZmgWZzuPOmq0fnxALGxkV");

    expect(parsed.layout).toBe("v1-legacy");
    expect(parsed.timestamp).toBe(2 ** 32 - 1);
  });

  it("rewrites an id in the other layout and back", () => {
    const legacy = "user_0008qTHxTCVP6UGxYPdlenlmENvVo";
    const v2 = "user_000000CjU4xZOW5fg8JiC424Gryym";

    expect(Ksuid.parse(legacy).withLayout("v2").toString()).toBe(v2);
    expect(Ksuid.parse(v2).withLayout("v1-legacy").toString()).toBe(legacy);
  });

  it("refuses a legacy timestamp the legacy layout cannot hold", () => {
    expect(() => encode({ timestamp: 2 ** 32, layout: "v1-legacy" })).toThrow(
      "timestamp must be a uint32",
    );
  });
});
