import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { virtualKeyDetailUrl } from "../_shared";

describe("virtualKeyDetailUrl", () => {
  const savedUiEndpoint = process.env.LANGWATCH_UI_ENDPOINT;

  beforeEach(() => {
    process.env.LANGWATCH_UI_ENDPOINT = "https://app.langwatch.ai";
  });

  afterEach(() => {
    if (savedUiEndpoint === undefined) {
      delete process.env.LANGWATCH_UI_ENDPOINT;
    } else {
      process.env.LANGWATCH_UI_ENDPOINT = savedUiEndpoint;
    }
  });

  describe("when building the dashboard link for a virtual key", () => {
    /** @scenario The CLI prints the new gateway address for a virtual key */
    it("points at the top-level gateway address", () => {
      expect(virtualKeyDetailUrl("vk_123")).toBe(
        "https://app.langwatch.ai/gateway/virtual-keys/vk_123",
      );
    });

    it("URL-encodes the key id", () => {
      expect(virtualKeyDetailUrl("vk/odd id")).toBe(
        "https://app.langwatch.ai/gateway/virtual-keys/vk%2Fodd%20id",
      );
    });
  });
});
