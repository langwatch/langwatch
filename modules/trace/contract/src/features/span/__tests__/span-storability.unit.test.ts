import { describe, expect, it } from "vitest";

import { MAX_STORABLE_SPAN_TIME_MS, storableSpanTimesOf } from "../span-storability.ts";

const msToNano = (ms: number) => String(BigInt(ms) * 1_000_000n);

describe("storableSpanTimesOf()", () => {
  it("returns both times in epoch ms when storage can hold them", () => {
    expect(
      storableSpanTimesOf({
        startTimeUnixNano: msToNano(1_700_000_000_000),
        endTimeUnixNano: msToNano(1_700_000_000_500),
      }),
    ).toEqual({ times: { startTimeUnixMs: 1_700_000_000_000, endTimeUnixMs: 1_700_000_000_500 } });
  });

  it("names the start time when it is past the storable ceiling", () => {
    expect(
      storableSpanTimesOf({
        startTimeUnixNano: msToNano(MAX_STORABLE_SPAN_TIME_MS + 1),
        endTimeUnixNano: msToNano(1_700_000_000_500),
      }),
    ).toEqual({
      unstorable: { field: "startTimeUnixMs", valueMs: MAX_STORABLE_SPAN_TIME_MS + 1 },
    });
  });

  it("names the end time when it is not a positive instant", () => {
    expect(
      storableSpanTimesOf({ startTimeUnixNano: msToNano(1_700_000_000_000), endTimeUnixNano: "0" }),
    ).toEqual({ unstorable: { field: "endTimeUnixMs", valueMs: 0 } });
  });
});
