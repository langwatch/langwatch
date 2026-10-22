/** @vitest-environment node */

import { HandledError } from "@langwatch/handled-error";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordIngestDoorRefusal,
  resetIngestDoorRefusalLog,
  withClientFaultSpan,
} from "../door.ts";

class Refused extends HandledError {
  declare readonly code: "invalid_credentials";

  constructor() {
    super("invalid_credentials", "Invalid API key", { httpStatus: 401, fault: "customer" });
  }
}

const refusal = () => new Refused();

const diagnostics = {
  path: "/api/otel/v1/traces",
  method: "POST",
  userAgent: "exporter/1",
  traceparent: null,
  forwardedFor: "203.0.113.9",
  hasEmptyAuthToken: false,
};

describe("recordIngestDoorRefusal", () => {
  let metrics = createRecordingMeterProvider();
  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    resetIngestDoorRefusalLog();
    metrics.install();
  });
  afterEach(() => metrics.uninstall());

  describe("when one caller is refused repeatedly", () => {
    it("warns once per window with the held-back count and counts every refusal", () => {
      const logger = { warn: vi.fn(), debug: vi.fn() };
      const record = (now: number) =>
        recordIngestDoorRefusal({
          logger,
          signal: "traces",
          error: refusal(),
          diagnostics,
          now,
        });

      record(0);
      record(1_000);
      record(2_000);
      record(61_000);

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenCalledTimes(2);
      expect(logger.warn.mock.calls[1]?.[0]).toMatchObject({ suppressedRefusals: 2 });
      expect(
        metrics.valueOf("langwatch_ingest_door_refusals_total", {
          signal: "traces",
          code: "invalid_credentials",
          status: 401,
        }),
      ).toBe(4);
    });
  });
});

describe("withClientFaultSpan", () => {
  /** A tracer-like opener that marks the span ERROR when the callback throws, as the SDK does. */
  function opener() {
    const span = { recordException: vi.fn(), setAttributes: vi.fn(), status: "UNSET" };
    const open = async <T>(run: (s: typeof span) => Promise<T>) => {
      try {
        return await run(span);
      } catch (error) {
        span.status = "ERROR";
        throw error;
      }
    };
    return { span, open };
  }

  it("rethrows a customer fault with the span left unset and the exception recorded", async () => {
    const { span, open } = opener();
    const error = refusal();

    await expect(withClientFaultSpan(open, () => Promise.reject(error))).rejects.toBe(error);

    expect(span.status).toBe("UNSET");
    expect(span.recordException).toHaveBeenCalledWith(error);
  });

  it("lets any other failure through the span", async () => {
    const { span, open } = opener();

    await expect(
      withClientFaultSpan(open, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    expect(span.status).toBe("ERROR");
  });

  it("returns the body's value on success", async () => {
    const { open } = opener();
    await expect(withClientFaultSpan(open, () => Promise.resolve(7))).resolves.toBe(7);
  });
});
