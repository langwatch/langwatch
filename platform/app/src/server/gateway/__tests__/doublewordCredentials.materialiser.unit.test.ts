/**
 * Doubleword is credentialed with an API key only. The materialiser is where
 * that key leaves the control plane for the gateway.
 *
 * Covers @unit scenarios from specs/model-providers/doubleword-provider.feature.
 */

import { describe, expect, it } from "vitest";
import type { ModelProvider } from "~/generated/prisma/client";
import { buildCredentials } from "../config.materialiser";

const doublewordRow = (customKeys: Record<string, string>): ModelProvider =>
  ({
    provider: "doubleword",
    customKeys,
  }) as unknown as ModelProvider;

describe("buildCredentials for doubleword", () => {
  describe("given a credential saved with an API key", () => {
    /** @scenario A Doubleword credential reaches the gateway with its API key */
    it("carries the API key", () => {
      const credentials = buildCredentials(
        doublewordRow({ DOUBLEWORD_API_KEY: "sk-dw-test" }),
      );

      expect(credentials).toEqual({ api_key: "sk-dw-test" });
    });
  });
});
