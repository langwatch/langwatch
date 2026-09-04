/**
 * What a returning session tells Customer.io, and how rarely.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireActivityTrackingNurturing,
  resetActivityTrackingCache,
} from "../nurturing-activity-tracking.service";
import {
  registerNoNurturingSink,
  registerNurturingSink,
  settle,
} from "./support/nurturing-harness";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  resetActivityTrackingCache();
});
afterEach(() => {
  registerNoNurturingSink();
  resetActivityTrackingCache();
});

describe("fireActivityTrackingNurturing", () => {
  describe("given a person whose session has just been established", () => {
    describe("when the session callback fires", () => {
      /** @scenario "User login pushes last_active_at to Customer.io" */
      it("identifies them with the moment they were last active", async () => {
        const sink = registerNurturingSink();

        fireActivityTrackingNurturing({ userId: "user-1" });
        await settle();

        const [call] = sink.sentTo("/identify") as [
          { userId: string; traits: { last_active_at: string } },
        ];
        expect(call.userId).toBe("user-1");
        expect(Date.parse(call.traits.last_active_at)).not.toBeNaN();
      });
    });
  });

  describe("given a person refreshing their session repeatedly within the hour", () => {
    describe("when the session callback fires each time", () => {
      /** @scenario "Activity tracking is debounced to avoid excessive API calls" */
      it("identifies them once, not once per refresh", async () => {
        const sink = registerNurturingSink();

        fireActivityTrackingNurturing({ userId: "user-1" });
        fireActivityTrackingNurturing({ userId: "user-1" });
        fireActivityTrackingNurturing({ userId: "user-1" });
        await settle();

        expect(sink.sentTo("/identify")).toHaveLength(1);
      });
    });
  });

  describe("given Customer.io is unavailable", () => {
    describe("when the session callback fires", () => {
      /** @scenario "Activity tracking failure does not break the login flow" */
      it("returns normally and reports the failure for observability", async () => {
        const sink = registerNurturingSink({ failing: true });

        expect(() => fireActivityTrackingNurturing({ userId: "user-1" })).not.toThrow();
        await settle();

        expect(sink.errorReporter.capture).toHaveBeenCalled();
      });
    });
  });
});
