import { describe, expect, it, vi } from "vitest";
import { createSpanReceivedEvent } from "../../projections/__tests__/fixtures/trace-summary-test.fixtures";
import {
  isStorableSpanReceived,
  isStorableSpanTimeMs,
  MAX_STORABLE_SPAN_TIME_MS,
} from "../storableSpanTime";

function makeLogger() {
  return {
    warn: vi.fn<(fields: Record<string, unknown>, message: string) => void>(),
  };
}

describe("isStorableSpanTimeMs", () => {
  describe("given a value that is not an epoch-ms instant at all", () => {
    it.each([
      null,
      undefined,
      0,
      -1,
      NaN,
      Infinity,
      -Infinity,
    ])("refuses %s", (value) => {
      expect(isStorableSpanTimeMs(value as number | null | undefined)).toBe(
        false,
      );
    });
  });

  describe("given a present-day millisecond value", () => {
    it("accepts it", () => {
      expect(isStorableSpanTimeMs(1_700_000_000_500)).toBe(true);
    });

    it("accepts a fractional millisecond, which both the id and the column can hold", () => {
      expect(isStorableSpanTimeMs(1_700_000_000_500.5)).toBe(true);
    });
  });

  describe("given the storage ceiling", () => {
    it("names 2299-12-31T23:59:59.999Z, the DateTime64(3) maximum", () => {
      expect(new Date(MAX_STORABLE_SPAN_TIME_MS).toISOString()).toBe(
        "2299-12-31T23:59:59.999Z",
      );
    });

    it("accepts the ceiling itself", () => {
      expect(isStorableSpanTimeMs(MAX_STORABLE_SPAN_TIME_MS)).toBe(true);
    });

    it("refuses one millisecond past it", () => {
      expect(isStorableSpanTimeMs(MAX_STORABLE_SPAN_TIME_MS + 1)).toBe(false);
    });
  });

  describe("given a far-future but storable value", () => {
    it("accepts a span starting in 2100", () => {
      expect(isStorableSpanTimeMs(Date.UTC(2100, 0, 1))).toBe(true);
    });
  });

  describe("given a nanosecond-scale value mistaken for milliseconds", () => {
    it("refuses it", () => {
      expect(isStorableSpanTimeMs(1_700_000_000_500 * 1_000_000)).toBe(false);
    });
  });
});

describe("isStorableSpanReceived", () => {
  describe("given a span whose times are ordinary millisecond values", () => {
    it("accepts it and logs nothing", () => {
      const logger = makeLogger();

      expect(
        isStorableSpanReceived({
          event: createSpanReceivedEvent(),
          logger,
          consumer: "test",
        }),
      ).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("given a span whose start time is milliseconds scaled to nanoseconds twice", () => {
    it("refuses it and logs once, naming the tenant, span and offending value", () => {
      const logger = makeLogger();

      const accepted = isStorableSpanReceived({
        event: createSpanReceivedEvent({
          tenantId: "project-unstorable",
          spanId: "bbbb0000000000ff",
          startTimeUnixNano: String(
            1_700_000_000_500n * 1_000_000n * 1_000_000n,
          ),
        }),
        logger,
        consumer: "test",
      });

      expect(accepted).toBe(false);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        tenantId: "project-unstorable",
        spanId: "bbbb0000000000ff",
        field: "startTimeUnixMs",
      });
    });
  });

  describe("given a span whose end time alone cannot be stored", () => {
    it("refuses it and names the end time", () => {
      const logger = makeLogger();

      const accepted = isStorableSpanReceived({
        event: createSpanReceivedEvent({
          endTimeUnixNano: String(1_700_000_000_500n * 1_000_000n * 1_000_000n),
        }),
        logger,
        consumer: "test",
      });

      expect(accepted).toBe(false);
      expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({
        field: "endTimeUnixMs",
      });
    });
  });

  describe("given a span whose start time is a far-future but storable instant", () => {
    it("accepts it, because storage can hold it", () => {
      const logger = makeLogger();
      const year2100Ms = Date.UTC(2100, 0, 1);

      expect(
        isStorableSpanReceived({
          event: createSpanReceivedEvent({
            startTimeUnixNano: String(BigInt(year2100Ms) * 1_000_000n),
            endTimeUnixNano: String(BigInt(year2100Ms + 2000) * 1_000_000n),
          }),
          logger,
          consumer: "test",
        }),
      ).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
