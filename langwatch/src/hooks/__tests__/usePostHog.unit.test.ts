/**
 * Unit tests for the PostHog before_send callback and impersonation state.
 *
 * Verifies:
 * - before_send drops capture events during impersonation
 * - before_send allows capture events for normal sessions
 * - before_send allows $snapshot events during impersonation (session recording)
 * - Impersonation state module-level ref updates correctly
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  impersonationBeforeSend,
  setPostHogImpersonationState,
  getPostHogImpersonationState,
} from "../usePostHog";

describe("impersonationBeforeSend", () => {
  beforeEach(() => {
    setPostHogImpersonationState(false);
  });

  describe("when not impersonating", () => {
    it("returns the event unchanged for capture events", () => {
      const event = { event: "$autocapture", properties: {} };
      expect(impersonationBeforeSend(event)).toBe(event);
    });

    it("returns the event unchanged for pageview events", () => {
      const event = { event: "$pageview", properties: {} };
      expect(impersonationBeforeSend(event)).toBe(event);
    });

    it("returns the event unchanged for custom events", () => {
      const event = { event: "evaluation_ran", properties: {} };
      expect(impersonationBeforeSend(event)).toBe(event);
    });

    it("returns the event unchanged for $snapshot events", () => {
      const event = { event: "$snapshot", properties: {} };
      expect(impersonationBeforeSend(event)).toBe(event);
    });
  });

  describe("when impersonating", () => {
    beforeEach(() => {
      setPostHogImpersonationState(true);
    });

    it("drops $autocapture events", () => {
      const event = { event: "$autocapture", properties: {} };
      expect(impersonationBeforeSend(event)).toBeNull();
    });

    it("drops $pageview events", () => {
      const event = { event: "$pageview", properties: {} };
      expect(impersonationBeforeSend(event)).toBeNull();
    });

    it("drops custom capture events", () => {
      const event = { event: "evaluation_ran", properties: {} };
      expect(impersonationBeforeSend(event)).toBeNull();
    });

    it("allows $snapshot events through (session recording)", () => {
      const event = { event: "$snapshot", properties: {} };
      expect(impersonationBeforeSend(event)).toBe(event);
    });

    it("allows $exception events through (error capture)", () => {
      const event = { event: "$exception", properties: {} };
      expect(impersonationBeforeSend(event)).toBe(event);
    });
  });
});

describe("setPostHogImpersonationState", () => {
  beforeEach(() => {
    setPostHogImpersonationState(false);
  });

  it("sets state to true", () => {
    setPostHogImpersonationState(true);
    expect(getPostHogImpersonationState()).toBe(true);
  });

  it("sets state to false", () => {
    setPostHogImpersonationState(true);
    setPostHogImpersonationState(false);
    expect(getPostHogImpersonationState()).toBe(false);
  });
});
