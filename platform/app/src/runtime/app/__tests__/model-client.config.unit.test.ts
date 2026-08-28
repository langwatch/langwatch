import { describe, expect, it } from "vitest";
import { resolveModelClientConfig } from "../model-client.config";

describe("resolveModelClientConfig", () => {
  it("projects the nlpgo execution endpoint into model-client vocabulary", () => {
    expect(
      resolveModelClientConfig({ LANGWATCH_NLP_SERVICE: "https://nlp.internal.example" }),
    ).toEqual({ executionProxyUrl: "https://nlp.internal.example" });
  });

  it("resolves the gateway deployment fallback order into one semantic value", () => {
    expect(
      resolveModelClientConfig({
        LW_GATEWAY_BASE_URL: "https://gateway.legacy.example",
        LW_GATEWAY_PUBLIC_URL: "https://gateway.public.example",
        LW_GATEWAY_INTERNAL_URL: "https://gateway.internal.example",
      }),
    ).toEqual({ codexGatewayUrl: "https://gateway.internal.example" });
  });

  it("rejects an invalid execution endpoint before model SDK composition", () => {
    expect(() => resolveModelClientConfig({ LANGWATCH_NLP_SERVICE: "not a URL" })).toThrow(
      "Invalid model client configuration",
    );
  });
});
