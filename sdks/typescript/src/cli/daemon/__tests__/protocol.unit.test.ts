import { describe, expect, it } from "vitest";

import { encodeFrame, FrameDecoder, type ServerFrame } from "../protocol";

describe("FrameDecoder", () => {
  describe("given a frame split across several socket reads", () => {
    it("emits it once, whole", () => {
      const decoder = new FrameDecoder<ServerFrame>();
      const wire = encodeFrame({ t: "exit", code: 7 });

      expect(decoder.push(wire.slice(0, 5))).toEqual([]);
      expect(decoder.push(wire.slice(5, 9))).toEqual([]);
      expect(decoder.push(wire.slice(9))).toEqual([{ t: "exit", code: 7 }]);
    });
  });

  describe("given several frames in one socket read", () => {
    it("emits them all, in order", () => {
      const decoder = new FrameDecoder<ServerFrame>();

      const frames = decoder.push(
        encodeFrame({ t: "out", d: "YQ==" }) +
          encodeFrame({ t: "err", d: "Yg==" }) +
          encodeFrame({ t: "exit", code: 0 }),
      );

      expect(frames).toEqual([
        { t: "out", d: "YQ==" },
        { t: "err", d: "Yg==" },
        { t: "exit", code: 0 },
      ]);
    });
  });

  describe("given output that is not valid UTF-8", () => {
    it("round-trips the exact bytes, because base64 does not care what they mean", () => {
      // A lone continuation byte and a NUL — a naive string encoding mangles both.
      const raw = Buffer.from([0x00, 0xff, 0x80, 0x41, 0xf0, 0x9f, 0x92, 0xa9]);
      const decoder = new FrameDecoder<ServerFrame>();

      const [frame] = decoder.push(
        encodeFrame({ t: "out", d: raw.toString("base64") }),
      );

      expect(frame).toBeDefined();
      const decoded = Buffer.from((frame as { d: string }).d, "base64");
      expect(decoded.equals(raw)).toBe(true);
    });
  });

  describe("given output containing newlines", () => {
    it("does not mistake the payload's newlines for frame boundaries", () => {
      const payload = Buffer.from("line one\nline two\n");
      const decoder = new FrameDecoder<ServerFrame>();

      const frames = decoder.push(
        encodeFrame({ t: "out", d: payload.toString("base64") }),
      );

      expect(frames).toHaveLength(1);
      expect(
        Buffer.from((frames[0] as { d: string }).d, "base64").toString(),
      ).toBe("line one\nline two\n");
    });
  });

  describe("given a peer that never sends a newline", () => {
    it("throws rather than buffering without bound", () => {
      const decoder = new FrameDecoder<ServerFrame>(16);

      expect(() => decoder.push("x".repeat(64))).toThrow(/maximum size/);
    });
  });
});
