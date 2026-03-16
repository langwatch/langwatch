/**
 * @vitest-environment node
 *
 * Unit tests for trackServerEvent helper.
 *
 * Verifies:
 * - Captures events with correct distinctId, event name, and properties
 * - Includes projectId in properties when provided
 * - Silently no-ops when POSTHOG_KEY is not set
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockCapture } = vi.hoisted(() => ({
  mockCapture: vi.fn(),
}));

vi.mock("posthog-node", () => ({
  PostHog: function () {
    return { capture: mockCapture, shutdown: vi.fn() };
  },
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    POSTHOG_KEY: "phc_test_key",
    POSTHOG_HOST: "https://us.i.posthog.com",
  },
}));

import { trackServerEvent } from "../posthog";

describe("trackServerEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when PostHog is initialized", () => {
    it("captures event with userId as distinctId", () => {
      trackServerEvent({
        userId: "user-123",
        event: "limit_blocked",
      });

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: "user-123",
        event: "limit_blocked",
        properties: {},
      });
    });

    it("includes custom properties", () => {
      trackServerEvent({
        userId: "user-123",
        event: "limit_blocked",
        properties: { limitType: "workflows", current: 5, max: 5 },
      });

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: "user-123",
        event: "limit_blocked",
        properties: { limitType: "workflows", current: 5, max: 5 },
      });
    });

    it("includes projectId in properties when provided", () => {
      trackServerEvent({
        userId: "user-123",
        event: "scenario_created",
        projectId: "proj-456",
      });

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: "user-123",
        event: "scenario_created",
        properties: { projectId: "proj-456" },
      });
    });

    it("merges projectId with other properties", () => {
      trackServerEvent({
        userId: "user-123",
        event: "team_member_invited",
        projectId: "proj-456",
        properties: { inviteCount: 3 },
      });

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: "user-123",
        event: "team_member_invited",
        properties: { inviteCount: 3, projectId: "proj-456" },
      });
    });

    it("omits projectId from properties when not provided", () => {
      trackServerEvent({
        userId: "user-123",
        event: "team_member_invited",
        properties: { inviteCount: 3 },
      });

      expect(mockCapture).toHaveBeenCalledWith({
        distinctId: "user-123",
        event: "team_member_invited",
        properties: { inviteCount: 3 },
      });
    });
  });
});
