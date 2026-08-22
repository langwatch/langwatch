import { describe, expect, it } from "vitest";
import { ProtocolWriter, type ProtocolSink } from "./writer.js";

describe("ProtocolWriter", () => {
  describe("when several events are emitted", () => {
    it("writes one JSON line each, in order", async () => {
      const chunks: string[] = [];
      const sink: ProtocolSink = (chunk, callback) => {
        chunks.push(chunk);
        callback();
        return true;
      };
      const writer = new ProtocolWriter(sink);
      void writer.emit({ type: "ready", protocol: 1 });
      void writer.emit({ type: "pong" });
      await writer.flush();
      expect(chunks).toEqual(['{"type":"ready","protocol":1}\n', '{"type":"pong"}\n']);
    });
  });

  describe("when the sink completes asynchronously (backpressure)", () => {
    it("keeps ordering and resolves emit only after the write callback fires", async () => {
      const chunks: string[] = [];
      const pending: Array<() => void> = [];
      const sink: ProtocolSink = (chunk, callback) => {
        chunks.push(chunk);
        pending.push(() => callback());
        return false;
      };
      const writer = new ProtocolWriter(sink);
      let hasFirstWriteFlushed = false;
      void writer.emit({ n: 1 }).then(() => {
        hasFirstWriteFlushed = true;
      });
      const second = writer.emit({ n: 2 });

      await new Promise((resolve) => setTimeout(resolve, 0));
      // Second write must not start before the first's callback fired.
      expect(chunks).toEqual(['{"n":1}\n']);
      expect(hasFirstWriteFlushed).toBe(false);

      pending.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(hasFirstWriteFlushed).toBe(true);
      expect(chunks).toEqual(['{"n":1}\n', '{"n":2}\n']);

      pending.shift()?.();
      await second;
    });
  });

  describe("when the sink reports an error (manager died)", () => {
    it("still resolves so the process can exit instead of hanging", async () => {
      const sink: ProtocolSink = (_chunk, callback) => {
        callback(new Error("EPIPE"));
        return true;
      };
      const writer = new ProtocolWriter(sink);
      await expect(writer.emit({ type: "turn_done" })).resolves.toBeUndefined();
    });
  });

  describe("when the sink throws synchronously", () => {
    it("contains the throw and keeps the chain alive", async () => {
      let calls = 0;
      const sink: ProtocolSink = (_chunk, callback) => {
        calls++;
        if (calls === 1) throw new Error("boom");
        callback();
        return true;
      };
      const writer = new ProtocolWriter(sink);
      await writer.emit({ n: 1 });
      await writer.emit({ n: 2 });
      expect(calls).toBe(2);
    });
  });
});
