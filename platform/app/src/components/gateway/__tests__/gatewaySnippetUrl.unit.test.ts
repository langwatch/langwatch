import { describe, expect, it } from "vitest";

import {
  HOSTED_GATEWAY_URL,
  resolveSnippetGatewayBaseUrl,
} from "../gatewaySnippetUrl";

describe("resolveSnippetGatewayBaseUrl", () => {
  describe("when this deployment exposes its gateway URL via publicEnv", () => {
    it("uses the deployment URL with a /v1 suffix, not the SaaS default", () => {
      expect(
        resolveSnippetGatewayBaseUrl(
          undefined,
          "https://gw.selfhosted.example",
        ),
      ).toBe("https://gw.selfhosted.example/v1");
    });

    it("strips a trailing slash before appending /v1", () => {
      expect(
        resolveSnippetGatewayBaseUrl(undefined, "http://localhost:5563/"),
      ).toBe("http://localhost:5563/v1");
    });
  });

  describe("when an explicit override prop is provided", () => {
    it("uses the override verbatim over the deployment URL", () => {
      expect(
        resolveSnippetGatewayBaseUrl(
          "https://override.example/v1",
          "https://gw.selfhosted.example",
        ),
      ).toBe("https://override.example/v1");
    });
  });

  describe("when publicEnv has not resolved yet", () => {
    it("falls back to the hosted SaaS URL", () => {
      expect(resolveSnippetGatewayBaseUrl(undefined, undefined)).toBe(
        HOSTED_GATEWAY_URL,
      );
      expect(resolveSnippetGatewayBaseUrl(undefined, null)).toBe(
        HOSTED_GATEWAY_URL,
      );
    });
  });
});
