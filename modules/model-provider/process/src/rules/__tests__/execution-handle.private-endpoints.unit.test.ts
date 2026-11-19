import { PRIVATE_ENDPOINTS_HEADER } from "@langwatch/model-provider-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleForParameters } from "../execution-handle.rules.ts";

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

/** The headers the handle sends to nlpgo's proxy on one call. */
async function headersSent(privateEndpoints: (typeof INFERENCE)[] | undefined): Promise<Headers> {
  let sent = new Headers();
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent = new Headers(init.headers);
    return new Response(JSON.stringify({ error: { message: "stop" } }), { status: 400 });
  });
  const model = handleForParameters({
    providerKey: "custom",
    model: "custom/llama",
    parameters: { api_key: "sk-test", api_base: "https://llm.internal.acme.test/v1" },
    executionProxyBaseUrl: "http://nlp.test/go/proxy/v1",
    privateEndpoints,
  });
  await Promise.resolve(
    model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }),
  ).catch(() => undefined);
  return sent;
}

describe("handleForParameters", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("given the organization bound a hostname", () => {
    /** @scenario "<path> reaches the private endpoint through a bound hostname" */
    it("sends nlpgo the bindings in the private endpoints header beside the provider parameters", async () => {
      const sent = await headersSent([INFERENCE]);
      const header = sent.get(PRIVATE_ENDPOINTS_HEADER);

      expect(sent.get("x-litellm-api_base")).toBe("https://llm.internal.acme.test/v1");
      expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString("utf8"))).toEqual([
        INFERENCE,
      ]);
    });
  });

  describe("given the organization bound nothing", () => {
    it("sends no private endpoints header at all", async () => {
      expect((await headersSent([])).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
      expect((await headersSent(undefined)).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
    });
  });
});
