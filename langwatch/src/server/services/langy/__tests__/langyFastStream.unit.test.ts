import { describe, expect, it, vi } from "vitest";
import {
  decodeFastFrame,
  LANGY_FAST_STREAM,
  LangyFastTokenPublisher,
} from "../streaming/langyFastStream";

describe("decodeFastFrame", () => {
  describe("given a token frame", () => {
    it("decodes the token text", () => {
      expect(decodeFastFrame(JSON.stringify({ d: "Hel" }))).toEqual({
        token: "Hel",
      });
    });
  });

  describe("given an end frame", () => {
    it("decodes the terminal signal", () => {
      expect(decodeFastFrame(JSON.stringify({ e: 1 }))).toEqual({ end: true });
    });
  });

  describe("given a malformed or unknown payload", () => {
    it("returns null rather than throwing", () => {
      expect(decodeFastFrame("not json")).toBeNull();
      expect(decodeFastFrame(JSON.stringify({ x: 1 }))).toBeNull();
      expect(decodeFastFrame(JSON.stringify({ d: 5 }))).toBeNull();
      expect(decodeFastFrame(JSON.stringify({ e: 2 }))).toBeNull();
    });
  });
});

describe("LangyFastTokenPublisher", () => {
  const conversationId = "conv-1";
  const turnId = "turn-1";
  const channel = LANGY_FAST_STREAM.channel(conversationId, turnId);

  describe("when publishing a token", () => {
    it("publishes the token frame to the per-turn channel", async () => {
      const publish = vi.fn().mockResolvedValue(1);
      const publisher = new LangyFastTokenPublisher({ publish });
      await publisher.publishToken({ conversationId, turnId, text: "Hi" });
      expect(publish).toHaveBeenCalledWith(channel, JSON.stringify({ d: "Hi" }));
    });

    it("drops an empty token without publishing", async () => {
      const publish = vi.fn().mockResolvedValue(1);
      const publisher = new LangyFastTokenPublisher({ publish });
      await publisher.publishToken({ conversationId, turnId, text: "" });
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe("when publishing end", () => {
    it("publishes the terminal frame", async () => {
      const publish = vi.fn().mockResolvedValue(1);
      const publisher = new LangyFastTokenPublisher({ publish });
      await publisher.publishEnd({ conversationId, turnId });
      expect(publish).toHaveBeenCalledWith(channel, JSON.stringify({ e: 1 }));
    });
  });
});
