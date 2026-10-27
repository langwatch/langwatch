import { describe, expect, it, vi } from "vitest";

import { HttpLitellmPriceChannel } from "../http/http.litellm-price.channel.ts";
import type { LitellmPriceRegistry } from "../litellm-price.channel.ts";
import { MemoryLitellmPriceChannel } from "../memory/memory.litellm-price.channel.ts";

function channelAnswering(respond: () => Promise<Response>) {
  return HttpLitellmPriceChannel.create({ request: vi.fn<typeof fetch>(respond) });
}

describe("HttpLitellmPriceChannel", () => {
  describe("when litellm answers its registry", () => {
    it("answers the well-formed entries and leaves the malformed ones out", async () => {
      const body = {
        "whisper-1": {
          mode: "audio_transcription",
          litellm_provider: "openai",
          input_cost_per_second: 0.0001,
        },
        broken: { input_cost_per_token: "free" },
      };
      const channel = channelAnswering(async () => new Response(JSON.stringify(body)));

      expect(await channel.fetchPriceRegistry()).toEqual({
        outcome: "fetched",
        prices: {
          "whisper-1": {
            mode: "audio_transcription",
            litellm_provider: "openai",
            input_cost_per_second: 0.0001,
          },
        },
      });
    });
  });

  describe("when litellm answers a non-success status", () => {
    it("answers unavailable with the status", async () => {
      const channel = channelAnswering(async () => new Response("gone", { status: 503 }));

      expect(await channel.fetchPriceRegistry()).toEqual({
        outcome: "unavailable",
        reason: "http_status",
        detail: "503",
      });
    });
  });

  describe("when the request never reaches litellm", () => {
    it("answers unavailable as a transport failure", async () => {
      const channel = channelAnswering(async () => {
        throw new TypeError("fetch failed");
      });

      expect(await channel.fetchPriceRegistry()).toEqual({
        outcome: "unavailable",
        reason: "transport_failed",
        detail: "fetch failed",
      });
    });
  });

  describe("when the body is not a registry object", () => {
    it("answers unavailable as a malformed body", async () => {
      const channel = channelAnswering(async () => new Response(JSON.stringify([1, 2])));

      const registry = await channel.fetchPriceRegistry();

      expect(registry).toMatchObject({ outcome: "unavailable", reason: "malformed_body" });
    });
  });
});

describe("MemoryLitellmPriceChannel", () => {
  describe("when no registry is bound", () => {
    it("answers unavailable rather than an empty registry", async () => {
      expect(await MemoryLitellmPriceChannel.create().fetchPriceRegistry()).toMatchObject({
        outcome: "unavailable",
      });
    });
  });

  describe("when a test binds a registry", () => {
    it("answers it", async () => {
      const registry: LitellmPriceRegistry = { outcome: "fetched", prices: {} };
      expect(await MemoryLitellmPriceChannel.create({ registry }).fetchPriceRegistry()).toBe(
        registry,
      );
    });
  });
});
