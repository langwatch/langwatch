/**
 * @vitest-environment jsdom
 *
 * @see specs/features/narrow-capture-exception-type.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import posthog from "posthog-js";
import { captureException } from "../model/posthog-error-capture";

vi.mock("posthog-js", () => ({
  default: { __loaded: true, capture: vi.fn() },
}));

const capture = vi.mocked(posthog.capture);

function capturedProperties(): Record<string, unknown> {
  const call = capture.mock.calls.at(0);
  if (!call) throw new Error("captureException raised no PostHog event");
  return (call[1] ?? {}) as Record<string, unknown>;
}

describe("captureException()", () => {
  beforeEach(() => {
    capture.mockClear();
  });

  describe("given an Error instance", () => {
    describe("when captureException is called with it", () => {
      /** @scenario "Captures full details from an Error instance" */
      it("reports its message, its constructor name and its stack", () => {
        class ConnectionError extends Error {}
        const error = new ConnectionError("connection failed");

        captureException(error);

        const properties = capturedProperties();
        expect(properties.$exception_message).toBe("connection failed");
        expect(properties.$exception_type).toBe("ConnectionError");
        expect(properties.$exception_stack_trace_raw).toBe(error.stack);
      });
    });
  });

  describe("given a string", () => {
    describe("when captureException is called with it", () => {
      /** @scenario "Captures a string as the exception message" */
      it("reports the string as the message under the plain Error type", () => {
        captureException("timeout occurred");

        const properties = capturedProperties();
        expect(properties.$exception_message).toBe("timeout occurred");
        expect(properties.$exception_type).toBe("Error");
        expect(properties).not.toHaveProperty("$exception_stack_trace_raw");
      });
    });
  });
});
