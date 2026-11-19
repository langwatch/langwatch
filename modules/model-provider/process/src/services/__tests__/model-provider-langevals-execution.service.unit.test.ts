/**
 * @vitest-environment node
 * @see specs/security/org-private-model-endpoints.feature
 */
import type { PrivateEndpointBindingWire } from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";

import { ModelProviderLangevalsExecutionService } from "../model-provider-langevals-execution.service.ts";

const PROXY = "http://nlp.internal:5561/go/proxy/v1";
const SIGNED = {
  "X-LangWatch-Private-Endpoints": "payload.signature",
  "X-LangWatch-Project-Id": "acme-prod",
};
const ACME_BINDING: PrivateEndpointBindingWire = {
  hostname: "llm.internal.acme.test",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

function serviceFor({
  parameters,
  bindings = [ACME_BINDING],
  signed = SIGNED,
  secret = "engine-secret",
}: {
  parameters: Record<string, string>;
  bindings?: PrivateEndpointBindingWire[];
  signed?: Record<string, string>;
  secret?: string | undefined;
}) {
  const headersForProject = vi.fn(async () => signed);
  const service = ModelProviderLangevalsExecutionService.create({
    modelProviders: { prepareExecution: async () => ({ ...parameters }) },
    privateEndpoints: { bindingsForProject: async () => bindings, headersForProject },
    executionProxyBaseUrl: PROXY,
    nlpInternalSecret: secret,
  });
  return { service, headersForProject };
}

describe("ModelProviderLangevalsExecutionService", () => {
  describe("given a model whose base URL host is bound in the project's organization", () => {
    const parameters = {
      model: "openai/judge",
      api_key: "customer-key",
      api_base: "https://llm.internal.acme.test/v1",
    };

    /** @scenario "A langevals model call to a bound hostname goes through nlpgo" */
    it("sends the call to nlpgo's proxy with the original parameters and the signed bindings as headers", async () => {
      const { service } = serviceFor({ parameters });

      const call = await service.prepare({ model: "custom/judge", projectId: "acme-prod" });

      expect(call.parameters).toMatchObject({
        model: "openai/openai/judge",
        api_base: PROXY,
        api_key: "langwatch-engine-proxy",
      });
      expect(JSON.parse(call.parameters.extra_headers!)).toEqual({
        "x-litellm-model": "openai/judge",
        "x-litellm-api_key": "customer-key",
        "x-litellm-api_base": "https://llm.internal.acme.test/v1",
        ...SIGNED,
      });
    });

    it("signs the bindings for long enough to outlast a clustering page", async () => {
      const { service, headersForProject } = serviceFor({ parameters });

      await service.prepare({ model: "custom/judge", projectId: "acme-prod" });

      expect(headersForProject).toHaveBeenCalledWith({ projectId: "acme-prod", ttlSeconds: 1800 });
    });

    it("names the engine proxy and its credential in headers for langevals, never in the parameters", async () => {
      const { service } = serviceFor({ parameters });

      const call = await service.prepare({ model: "custom/judge", projectId: "acme-prod" });

      expect(call.headers).toEqual({
        "X-LangWatch-NLP-Secret": "engine-secret",
        "X-LangWatch-Engine-Proxy": PROXY,
      });
      expect(JSON.stringify(call.parameters)).not.toContain("engine-secret");
    });

    it("matches the host whatever its case or trailing dot", async () => {
      const { service } = serviceFor({
        parameters: { ...parameters, api_base: "https://LLM.Internal.Acme.Test./v1" },
      });

      const call = await service.prepare({ model: "custom/judge", projectId: "acme-prod" });

      expect(call.parameters.api_base).toBe(PROXY);
    });

    describe("when this deployment holds no signing key", () => {
      it("leaves the call on its own route, where the bound host is refused", async () => {
        const { service } = serviceFor({ parameters, signed: {} });

        const call = await service.prepare({ model: "custom/judge", projectId: "acme-prod" });

        expect(call).toEqual({ parameters, headers: {} });
      });
    });
  });

  describe("given a model whose base URL host is not bound", () => {
    /** @scenario "A langevals model call to an unbound host keeps its route" */
    it.each([
      ["another host", { model: "openai/judge", api_base: "https://api.example.com/v1" }],
      ["no base URL", { model: "openai/gpt-5-mini", api_key: "sk" }],
      ["an IP-literal base URL", { model: "openai/judge", api_base: "https://10.20.1.21/v1" }],
    ])("leaves the parameters exactly as they were for %s", async (_case, parameters) => {
      const { service, headersForProject } = serviceFor({ parameters });

      const call = await service.prepare({ model: "openai/judge", projectId: "acme-prod" });

      expect(call).toEqual({ parameters, headers: {} });
      expect(headersForProject).not.toHaveBeenCalled();
    });

    it("leaves the parameters as they were when the organization bound nothing", async () => {
      const parameters = { model: "openai/judge", api_base: "https://llm.internal.acme.test/v1" };
      const { service } = serviceFor({ parameters, bindings: [] });

      const call = await service.prepare({ model: "custom/judge", projectId: "rival-prod" });

      expect(call).toEqual({ parameters, headers: {} });
    });
  });
});
