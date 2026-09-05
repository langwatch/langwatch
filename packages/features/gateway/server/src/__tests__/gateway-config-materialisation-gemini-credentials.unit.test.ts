/**
 * A bare Gemini key routes to the Gemini API; a key with project+location routes to Agent Platform. Pins the pair-or-nothing contract at the materialiser. Covers specs/model-providers/google-agent-platform.feature.
 */

import { describe, expect, it } from "vitest";
import type { ModelProvider } from "@langwatch/prisma-client/generated";
import { GatewayConfigAssemblyAdapter } from "../adapters/postgres.gateway-config-assembly.adapter";

const assembly = GatewayConfigAssemblyAdapter.create({ prisma: {} as never });
import type { GatewayModelProviderCredentialsPort } from "../ports/gateway-model-provider-credentials.port";

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
      const credentials = assembly.buildCredentials(
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
      const credentials = assembly.buildCredentials(
        geminiRow({ GEMINI_API_KEY: "AIzaAnAiStudioKey" }),
        credentialsPort,
      );

      expect(credentials).toEqual({ api_key: "AIzaAnAiStudioKey" });
    });

    // Half a pair names no door: the gateway's agent-platform detection
    // requires both, so emitting one alone would be a field nothing reads.
    it("drops a lone project or location", () => {
      expect(
        assembly.buildCredentials(
          geminiRow({ GEMINI_API_KEY: "k", GEMINI_PROJECT: "acme-123" }),
          credentialsPort,
        ),
      ).toEqual({ api_key: "k" });
      expect(
        assembly.buildCredentials(
          geminiRow({ GEMINI_API_KEY: "k", GEMINI_LOCATION: "global" }),
          credentialsPort,
        ),
      ).toEqual({ api_key: "k" });
    });

    // Whitespace-only is absent: rows stored before the schema trimmed
    // could carry it, and it must not pick the Agent Platform door.
    it("treats a whitespace-only project or location as absent", () => {
      expect(
        assembly.buildCredentials(
          geminiRow({
            GEMINI_API_KEY: "k",
            GEMINI_PROJECT: "   ",
            GEMINI_LOCATION: "global",
          }),
          credentialsPort,
        ),
      ).toEqual({ api_key: "k" });
      expect(
        assembly.buildCredentials(
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
