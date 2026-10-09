import { describe, expect, it, vi } from "vitest";

import type { DoublewordModelList } from "../doubleword-model.channel.ts";
import { HttpDoublewordModelChannel } from "../http/http.doubleword-model.channel.ts";
import { MemoryDoublewordModelChannel } from "../memory/memory.doubleword-model.channel.ts";

const FLASH = {
  model_name: "deepseek-ai/DeepSeek-V4.1-Flash",
  model_type: "CHAT",
  tariffs: [
    {
      name: "Realtime",
      input_price_per_token: "0.00000015",
      output_price_per_token: "0.00000060",
      api_key_purpose: "realtime",
      is_active: true,
      valid_until: null,
    },
  ],
};
const EMBEDDING = { model_name: "Qwen/Qwen3-Embedding-8B", model_type: "EMBEDDINGS" };

describe("HttpDoublewordModelChannel", () => {
  describe("when the model list spans several pages", () => {
    it("reads every page until total_count is reached", async () => {
      const pages = [
        { data: [FLASH], total_count: 2 },
        { data: [EMBEDDING], total_count: 2 },
      ];
      let answered = 0;
      const request = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify(pages[answered++])),
      );
      const channel = HttpDoublewordModelChannel.create({ request });

      const list = await channel.fetchModels({ apiKey: "platform-key" });

      expect(list).toMatchObject({
        outcome: "fetched",
        models: [{ model_name: FLASH.model_name }, { model_name: EMBEDDING.model_name }],
      });
      expect(String(request.mock.calls[0]?.[0])).toContain("include=pricing&limit=100&skip=0");
      expect(String(request.mock.calls[1]?.[0])).toContain("skip=100");
      expect(request.mock.calls[0]?.[1]).toEqual({
        headers: { Authorization: "Bearer platform-key" },
      });
    });
  });

  describe("when a model does not match the fields the mapper reads", () => {
    it("leaves it out and still ends on the page count", async () => {
      const request = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ data: [FLASH, { model_type: 7 }], total_count: 2 })),
      );
      const channel = HttpDoublewordModelChannel.create({ request });

      const list = await channel.fetchModels({ apiKey: "platform-key" });

      expect(list).toMatchObject({
        outcome: "fetched",
        models: [{ model_name: FLASH.model_name }],
      });
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe("when Doubleword refuses the key", () => {
    it("answers unavailable with the status", async () => {
      const channel = HttpDoublewordModelChannel.create({
        request: vi.fn<typeof fetch>(
          async () => new Response("Authentication required", { status: 401 }),
        ),
      });

      expect(await channel.fetchModels({ apiKey: "inference-key" })).toEqual({
        outcome: "unavailable",
        reason: "http_status",
        detail: "401",
      });
    });
  });

  describe("when the request never lands", () => {
    it("answers unavailable with the transport error", async () => {
      const channel = HttpDoublewordModelChannel.create({
        request: vi.fn<typeof fetch>(async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        }),
      });

      expect(await channel.fetchModels({ apiKey: "platform-key" })).toEqual({
        outcome: "unavailable",
        reason: "transport_failed",
        detail: "getaddrinfo ENOTFOUND",
      });
    });
  });

  describe("when the body is not a models page", () => {
    it("answers unavailable as malformed", async () => {
      const channel = HttpDoublewordModelChannel.create({
        request: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(["nope"]))),
      });

      expect(await channel.fetchModels({ apiKey: "platform-key" })).toMatchObject({
        outcome: "unavailable",
        reason: "malformed_body",
      });
    });
  });
});

describe("MemoryDoublewordModelChannel", () => {
  describe("when nothing is bound", () => {
    it("answers unavailable", async () => {
      expect(
        await MemoryDoublewordModelChannel.create().fetchModels({ apiKey: "k" }),
      ).toMatchObject({ outcome: "unavailable" });
    });
  });

  describe("when a list is bound", () => {
    it("answers that list", async () => {
      const list: DoublewordModelList = { outcome: "fetched", models: [] };
      expect(await MemoryDoublewordModelChannel.create({ list }).fetchModels({ apiKey: "k" })).toBe(
        list,
      );
    });
  });
});
