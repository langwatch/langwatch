/**
 * Unit tests for the Langy self-observability helper.
 * Binds the testable half of implementation-plan PR-1.3 — config resolution
 * and the telemetry-settings shape — without round-tripping a real trace
 * through the chat route (that wiring lands in a follow-up PR).
 */
import { describe, expect, it } from "vitest";

import {
  buildLangyTelemetrySettings,
  getLangyDogfoodConfig,
} from "~/server/observability/langy-tracer";

describe("getLangyDogfoodConfig", () => {
  describe("given both env vars set", () => {
    it("returns the config", () => {
      expect(
        getLangyDogfoodConfig({
          LANGY_DOGFOOD_PROJECT_ID: "proj_langy_dogfood",
          LANGY_DOGFOOD_API_KEY: "sk-lw-dogfood-123",
        }),
      ).toEqual({
        projectId: "proj_langy_dogfood",
        apiKey: "sk-lw-dogfood-123",
      });
    });
  });

  describe("given only the project id set", () => {
    it("returns null so traces don't ship to an unauthenticated endpoint", () => {
      expect(
        getLangyDogfoodConfig({
          LANGY_DOGFOOD_PROJECT_ID: "proj_langy_dogfood",
        }),
      ).toBeNull();
    });
  });

  describe("given only the api key set", () => {
    it("returns null so traces don't ship without a target project", () => {
      expect(
        getLangyDogfoodConfig({
          LANGY_DOGFOOD_API_KEY: "sk-lw-dogfood-123",
        }),
      ).toBeNull();
    });
  });

  describe("given neither env var", () => {
    it("returns null", () => {
      expect(getLangyDogfoodConfig({})).toBeNull();
    });
  });

  describe("given a kill-switch explicitly set to false", () => {
    it("returns null even when both creds are present", () => {
      expect(
        getLangyDogfoodConfig({
          LANGY_DOGFOOD_PROJECT_ID: "proj_langy_dogfood",
          LANGY_DOGFOOD_API_KEY: "sk-lw-dogfood-123",
          LANGY_DOGFOOD_ENABLED: "false",
        }),
      ).toBeNull();
    });
  });
});

describe("buildLangyTelemetrySettings", () => {
  const env = {
    LANGY_DOGFOOD_PROJECT_ID: "proj_langy_dogfood",
    LANGY_DOGFOOD_API_KEY: "sk-lw-dogfood-123",
  };

  describe("given the dogfood project is configured", () => {
    describe("when building telemetry for a chat call", () => {
      it("enables telemetry under the langy.chat functionId", () => {
        const settings = buildLangyTelemetrySettings(
          {
            userProjectId: "proj_user",
            userId: "user_42",
            conversationId: "conv_abc",
          },
          env,
        );
        expect(settings).not.toBeNull();
        expect(settings?.isEnabled).toBe(true);
        expect(settings?.functionId).toBe("langy.chat");
      });

      it("attaches the user's project id, user id, and conversation id as metadata", () => {
        const settings = buildLangyTelemetrySettings(
          {
            userProjectId: "proj_user",
            userId: "user_42",
            conversationId: "conv_abc",
          },
          env,
        );
        expect(settings?.metadata["langwatch.project_id"]).toBe("proj_user");
        expect(settings?.metadata["langwatch.user_id"]).toBe("user_42");
        expect(settings?.metadata["langy.conversation_id"]).toBe("conv_abc");
        expect(settings?.metadata["langy.user_project_id"]).toBe("proj_user");
      });

      it("tags the trace with langy.dogfood=true so the dogfood project can filter on it", () => {
        const settings = buildLangyTelemetrySettings(
          {
            userProjectId: "proj_user",
            userId: "user_42",
            conversationId: "conv_abc",
          },
          env,
        );
        expect(settings?.metadata["langy.dogfood"]).toBe("true");
      });

      it("records the mode (non-expert by default)", () => {
        const settings = buildLangyTelemetrySettings(
          {
            userProjectId: "proj_user",
            userId: "user_42",
            conversationId: "conv_abc",
          },
          env,
        );
        expect(settings?.metadata["langy.mode"]).toBe("non-expert");
      });

      it("records an explicit mode when provided", () => {
        const settings = buildLangyTelemetrySettings(
          {
            userProjectId: "proj_user",
            userId: "user_42",
            conversationId: "conv_abc",
            mode: "expert",
          },
          env,
        );
        expect(settings?.metadata["langy.mode"]).toBe("expert");
      });
    });
  });

  describe("given the dogfood project is NOT configured", () => {
    it("returns null so callers fall back to the inline telemetry config", () => {
      expect(
        buildLangyTelemetrySettings(
          {
            userProjectId: "proj_user",
            userId: "user_42",
            conversationId: "conv_abc",
          },
          {},
        ),
      ).toBeNull();
    });
  });
});
