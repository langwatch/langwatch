/**
 * @see specs/model-providers/model-picker-callable-ids.feature
 */
import { MASKED_KEY_PLACEHOLDER } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  ModelProviderEgress,
  type ModelProviderEgressResponse,
} from "../../../credential-probe/services/ssrf-model-provider-egress.service.ts";
import {
  HttpModelProviderModelListService,
  modelIdsFromListing,
} from "../http-model-provider-model-list.service.ts";

/** An egress that answers every GET with one body and records what was asked. */
class AnsweringEgress extends ModelProviderEgress {
  readonly asked: { url: string; headers: Record<string, string> }[] = [];

  constructor(private readonly answer: (url: string) => { status: number; body: unknown }) {
    super();
  }

  fetch(
    url: string,
    request: { headers: Record<string, string> },
  ): Promise<ModelProviderEgressResponse> {
    this.asked.push({ url, headers: request.headers });
    const { status, body } = this.answer(url);
    return Promise.resolve({
      ok: status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    });
  }

  isRedirectRefusal(): boolean {
    return false;
  }

  assertDestination(): Promise<void> {
    return Promise.resolve();
  }
}

describe("given a models answer", () => {
  describe("when it is read", () => {
    /** @scenario The model list is read from the OpenAI, Anthropic and Gemini answer shapes */
    it("returns bare ids from the OpenAI, Anthropic and Gemini shapes", () => {
      expect(modelIdsFromListing({ data: [{ id: "gpt-6-sol" }, { id: "gpt-4.1" }] })).toEqual([
        "gpt-6-sol",
        "gpt-4.1",
      ]);
      expect(modelIdsFromListing({ data: [{ id: "claude-opus-5-5", type: "model" }] })).toEqual([
        "claude-opus-5-5",
      ]);
      expect(modelIdsFromListing({ models: [{ name: "models/gemini-3-pro" }] })).toEqual([
        "gemini-3-pro",
      ]);
      expect(modelIdsFromListing({ error: "nope" })).toEqual([]);
      expect(modelIdsFromListing(null)).toEqual([]);
    });
  });
});

describe("given a provider credential", () => {
  describe("when OpenAI is asked for its list", () => {
    it("asks the models route with the key and returns its ids", async () => {
      const egress = new AnsweringEgress(() => ({
        status: 200,
        body: { data: [{ id: "gpt-6-sol" }] },
      }));
      const list = HttpModelProviderModelListService.create({ egress });

      const ids = await list.findServedModelIds({
        provider: "openai",
        customKeys: { OPENAI_API_KEY: "sk-test" },
      });

      expect(ids).toEqual(["gpt-6-sol"]);
      expect(egress.asked[0]?.url).toBe("https://api.openai.com/v1/models");
      expect(egress.asked[0]?.headers.Authorization).toBe("Bearer sk-test");
    });
  });

  describe("when Anthropic is asked for its list", () => {
    /** @scenario The model list is read from the OpenAI, Anthropic and Gemini answer shapes */
    it("asks for the whole list in one page", async () => {
      const egress = new AnsweringEgress(() => ({
        status: 200,
        body: { data: [{ id: "claude-x" }] },
      }));
      await HttpModelProviderModelListService.create({ egress }).findServedModelIds({
        provider: "anthropic",
        customKeys: { ANTHROPIC_API_KEY: "sk-ant" },
      });

      expect(egress.asked[0]?.url).toContain("limit=1000");
    });
  });

  describe("when a custom OpenAI-compatible endpoint is asked", () => {
    it("asks the endpoint's own models route", async () => {
      const egress = new AnsweringEgress(() => ({
        status: 200,
        body: { data: [{ id: "llama-4" }] },
      }));
      const ids = await HttpModelProviderModelListService.create({ egress }).findServedModelIds({
        provider: "custom",
        customKeys: { CUSTOM_API_KEY: "k", CUSTOM_BASE_URL: "https://llm.example.com/v1" },
      });

      expect(ids).toEqual(["llama-4"]);
      expect(egress.asked[0]?.url).toBe("https://llm.example.com/v1/models");
    });
  });

  describe("when the provider refuses the key", () => {
    it("answers no list", async () => {
      const egress = new AnsweringEgress(() => ({ status: 401, body: { error: "bad key" } }));
      expect(
        await HttpModelProviderModelListService.create({ egress }).findServedModelIds({
          provider: "openai",
          customKeys: { OPENAI_API_KEY: "sk-bad" },
        }),
      ).toEqual([]);
    });
  });

  describe("when the provider cannot be asked", () => {
    /** @scenario A provider that cannot be asked answers no list */
    it("sends nothing for Azure, Bedrock or a masked key", async () => {
      const egress = new AnsweringEgress(() => ({ status: 200, body: { data: [{ id: "x" }] } }));
      const list = HttpModelProviderModelListService.create({ egress });

      for (const credential of [
        {
          provider: "azure",
          customKeys: { AZURE_OPENAI_API_KEY: "k", AZURE_OPENAI_ENDPOINT: "https://a.example.com" },
        },
        { provider: "bedrock", customKeys: { AWS_ACCESS_KEY_ID: "a" } },
        { provider: "openai", customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER } },
        { provider: "openai", customKeys: {} },
      ]) {
        expect(await list.findServedModelIds(credential), credential.provider).toEqual([]);
      }
      expect(egress.asked).toEqual([]);
    });
  });
});
