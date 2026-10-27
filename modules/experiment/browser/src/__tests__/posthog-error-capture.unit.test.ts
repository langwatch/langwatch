/**
 * @vitest-environment jsdom
 *
 * @see specs/features/narrow-capture-exception-type.feature
 */
import { UiAnalytics } from "@langwatch/browser-host/analytics";
import { describe, expect, it, vi } from "vitest";

import { captureException } from "../model/posthog-error-capture.ts";

class RecordingUiAnalytics extends UiAnalytics {
  track = vi.fn();
  identify(): void {}
  group(): void {}
  reset(): void {}
}

function capturedProperties(analytics: RecordingUiAnalytics): Record<string, unknown> {
  expect(analytics.track).toHaveBeenCalledWith(expect.objectContaining({ name: "$exception" }));
  return analytics.track.mock.calls.at(0)?.[0].attributes ?? {};
}

describe("captureException()", () => {
  describe("given an Error instance", () => {
    describe("when captureException is called with it", () => {
      /** @scenario "Captures full details from an Error instance" */
      it("reports its message, its constructor name and its stack", () => {
        class ConnectionError extends Error {}
        const error = new ConnectionError("connection failed");
        const analytics = new RecordingUiAnalytics();

        captureException({ analytics, error });

        const properties = capturedProperties(analytics);
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
        const analytics = new RecordingUiAnalytics();

        captureException({ analytics, error: "timeout occurred" });

        const properties = capturedProperties(analytics);
        expect(properties.$exception_message).toBe("timeout occurred");
        expect(properties.$exception_type).toBe("Error");
        expect(properties).not.toHaveProperty("$exception_stack_trace_raw");
      });
    });
  });
});
