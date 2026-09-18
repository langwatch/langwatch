import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import { ModelProviderPlaygroundService } from "../model-provider-playground.service.ts";

const request = {
  projectId: "project-1",
  model: "openai/gpt-5-mini",
  systemPrompt: null,
  messages: [],
};

function service(getExecutionProviders: ModelProviderApi["getExecutionProviders"]) {
  return ModelProviderPlaygroundService.create({
    modelProviders: createApiFixture<ModelProviderApi>({ getExecutionProviders }),
    executionProxyBaseUrl: "http://nlp.test/go/proxy/v1",
  });
}

describe("ModelProviderPlaygroundService", () => {
  it("keeps the provider-not-configured response at the app boundary", async () => {
    const result = await service(async () => ({})).execute(request);

    expect(result.status).toBe(400);
    expect(result.headers["content-type"]).toBe("application/json");
    expect(new TextDecoder().decode((await result.body[Symbol.asyncIterator]().next()).value)).toBe(
      JSON.stringify({ error: "Provider not configured: openai" }),
    );
  });
});
