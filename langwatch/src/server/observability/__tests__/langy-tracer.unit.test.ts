/**
 * Unit tests for the Langy self-observability helper. Per PR-1.3.
 *
 * Two responsibilities under test:
 *   1. `isLangyDogfoodConfigured(env)` — true when LANGWATCH_API_KEY is set.
 *   2. `buildLangyTelemetrySettings(input)` — always returns enabled
 *      telemetry with Langy-specific metadata, ready to hand to streamText.
 */
import { describe, expect, it } from "vitest";

import {
  buildLangyTelemetrySettings,
  isLangyDogfoodConfigured,
} from "~/server/observability/langy-tracer";

describe("isLangyDogfoodConfigured", () => {
  describe("given LANGWATCH_API_KEY is set", () => {
    it("returns true so callers know the global OTEL pipeline will export", () => {
      expect(
        isLangyDogfoodConfigured({ LANGWATCH_API_KEY: "sk-lw-anything" }),
      ).toBe(true);
    });
  });

  describe("given LANGWATCH_API_KEY is missing", () => {
    it("returns false", () => {
      expect(isLangyDogfoodConfigured({})).toBe(false);
    });
  });

  describe("given LANGWATCH_API_KEY is an empty string", () => {
    it("returns false (empty string is not a credential)", () => {
      expect(isLangyDogfoodConfigured({ LANGWATCH_API_KEY: "" })).toBe(false);
    });
  });
});

describe("buildLangyTelemetrySettings", () => {
  describe("when building telemetry for a chat call", () => {
    it("always enables telemetry under the langy.chat functionId", () => {
      const settings = buildLangyTelemetrySettings({
        userProjectId: "proj_user",
        userId: "user_42",
        conversationId: "conv_abc",
      });
      expect(settings.isEnabled).toBe(true);
      expect(settings.functionId).toBe("langy.chat");
    });

    it("attaches the user's project id, user id, and conversation id as metadata", () => {
      const settings = buildLangyTelemetrySettings({
        userProjectId: "proj_user",
        userId: "user_42",
        conversationId: "conv_abc",
      });
      expect(settings.metadata["langwatch.project_id"]).toBe("proj_user");
      expect(settings.metadata["langwatch.user_id"]).toBe("user_42");
      expect(settings.metadata["langy.conversation_id"]).toBe("conv_abc");
      expect(settings.metadata["langy.user_project_id"]).toBe("proj_user");
    });

    it("tags the trace with langy.dogfood=true so the dogfood project can filter on it", () => {
      const settings = buildLangyTelemetrySettings({
        userProjectId: "proj_user",
        userId: "user_42",
        conversationId: "conv_abc",
      });
      expect(settings.metadata["langy.dogfood"]).toBe("true");
    });

    it("records the mode (non-expert by default)", () => {
      const settings = buildLangyTelemetrySettings({
        userProjectId: "proj_user",
        userId: "user_42",
        conversationId: "conv_abc",
      });
      expect(settings.metadata["langy.mode"]).toBe("non-expert");
    });

    it("records an explicit mode when provided", () => {
      const settings = buildLangyTelemetrySettings({
        userProjectId: "proj_user",
        userId: "user_42",
        conversationId: "conv_abc",
        mode: "expert",
      });
      expect(settings.metadata["langy.mode"]).toBe("expert");
    });
  });
});
