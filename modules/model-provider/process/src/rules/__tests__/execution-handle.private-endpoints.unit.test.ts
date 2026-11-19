import { randomBytes } from "node:crypto";

import {
  PRIVATE_ENDPOINTS_HEADER,
  PRIVATE_ENDPOINTS_PROJECT_HEADER,
  type PrivateEndpointsHeaders,
  signPrivateEndpointsHeaders,
} from "@langwatch/model-provider-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleForParameters } from "../execution-handle.rules.ts";

const INFERENCE = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

/** A fresh Ed25519 seed for this run, so no key material lives in the source. */
const TEST_SEED = randomBytes(32).toString("base64");

/** The headers the handle sends to nlpgo's proxy on one call. */
async function headersSent(
  privateEndpointsHeaders: PrivateEndpointsHeaders | undefined,
): Promise<Headers> {
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
    privateEndpointsHeaders,
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
    it("sends nlpgo the signed bindings and their project beside the provider parameters", async () => {
      const signed = await signPrivateEndpointsHeaders({
        organizationId: "org_acme",
        projectId: "acme-prod",
        bindings: [INFERENCE],
        signingKey: TEST_SEED,
      });

      const sent = await headersSent(signed);

      expect(sent.get("x-litellm-api_base")).toBe("https://llm.internal.acme.test/v1");
      expect(sent.get(PRIVATE_ENDPOINTS_HEADER)).toBe(signed[PRIVATE_ENDPOINTS_HEADER]);
      expect(sent.get(PRIVATE_ENDPOINTS_PROJECT_HEADER)).toBe("acme-prod");
    });
  });

  describe("given the organization bound nothing", () => {
    it("sends no private endpoints header at all", async () => {
      expect((await headersSent({})).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
      expect((await headersSent(undefined)).has(PRIVATE_ENDPOINTS_HEADER)).toBe(false);
    });
  });
});
