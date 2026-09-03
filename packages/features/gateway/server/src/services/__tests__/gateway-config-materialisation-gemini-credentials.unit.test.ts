/**
 * Gemini's credential can name one of two Google doors: a bare key goes to
 * the Gemini API, a key with a project and location goes to Agent Platform.
 * The materialiser is where that shape leaves the control plane, so the
 * pair-or-nothing contract is pinned here.
 *
 * Covers @unit scenarios from
 * specs/model-providers/google-agent-platform.feature.
 */

import { describe, expect, it } from "vitest";
import type { ModelProvider } from "@langwatch/prisma-client/generated";
import { buildCredentials } from "../gateway-config-materialisation.service";
import type { GatewayModelProviderCredentialsPort } from "../../ports/gateway-model-provider-credentials.port";

const geminiRow = (customKeys: Record<string, string>): ModelProvider =>
  ({
    provider: "gemini",
    customKeys,
  }) as unknown as ModelProvider;

const credentialsPort: GatewayModelProviderCredentialsPort = {
  readCustomKeys: (stored: unknown) => stored as Record<string, unknown>,
};

describe("buildCredentials for gemini", () => {
  describe("given a credential carrying a project and location", () => {
    /** @scenario A Gemini row with a project and location sends traffic through the Agent Platform door */
    it("carries the project and the location as the region", () => {
      const credentials = buildCredentials(
        geminiRow({
          GEMINI_API_KEY: "AQ.AnAgentPlatformKey",
          GEMINI_PROJECT: "acme-123",
          GEMINI_LOCATION: "us-central1",
        }),
        credentialsPort,
      );

      expect(credentials).toEqual({
        api_key: "AQ.AnAgentPlatformKey",
        project_id: "acme-123",
        region: "us-central1",
      });
    });
  });

  describe("given a credential with only an API key", () => {
    /** @scenario A Gemini row without a project sends traffic through the Gemini API door */
    it("carries no project and no region", () => {
      const credentials = buildCredentials(
        geminiRow({ GEMINI_API_KEY: "AIzaAnAiStudioKey" }),
        credentialsPort,
      );

      expect(credentials).toEqual({ api_key: "AIzaAnAiStudioKey" });
    });

    // Half a pair names no door: the gateway's agent-platform detection
    // requires both, so emitting one alone would be a field nothing reads.
    it("drops a lone project or location", () => {
      expect(
        buildCredentials(
          geminiRow({ GEMINI_API_KEY: "k", GEMINI_PROJECT: "acme-123" }),
          credentialsPort,
        ),
      ).toEqual({ api_key: "k" });
      expect(
        buildCredentials(
          geminiRow({ GEMINI_API_KEY: "k", GEMINI_LOCATION: "global" }),
          credentialsPort,
        ),
      ).toEqual({ api_key: "k" });
    });

    // Whitespace-only is absent: rows stored before the schema trimmed
    // could carry it, and it must not pick the Agent Platform door.
    it("treats a whitespace-only project or location as absent", () => {
      expect(
        buildCredentials(
          geminiRow({
            GEMINI_API_KEY: "k",
            GEMINI_PROJECT: "   ",
            GEMINI_LOCATION: "global",
          }),
          credentialsPort,
        ),
      ).toEqual({ api_key: "k" });
      expect(
        buildCredentials(
          geminiRow({
            GEMINI_API_KEY: "k",
            GEMINI_PROJECT: "acme-123",
            GEMINI_LOCATION: "  ",
          }),
          credentialsPort,
        ),
      ).toEqual({ api_key: "k" });
    });
  });
});
