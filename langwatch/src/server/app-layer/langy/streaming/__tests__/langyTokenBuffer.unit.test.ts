/**
 * The token buffer's hybrid flush policy.
 *
 * The old policy was size-only: a `delta` entry reached the stream only once
 * ~64 words had accumulated, so nothing rendered until a turn was nearly over
 * (a short answer appeared in one burst at the end). The hybrid policy is:
 *
 *   - the very FIRST delta of a turn flushes immediately (time-to-first-token);
 *   - then flush on size (~CHUNK_TOKENS words) OR on time (~FLUSH_AFTER_MS
 *     after the first pending token), whichever comes first.
 *
 * @see specs/langy/langy-dual-stream.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANGY_STREAMING } from "../langy.streaming.constants";
import { LangyTokenBuffer, type LangyStreamRedis } from "../langyTokenBuffer";

interface RecordedEntry {
  type: string;
  text?: string;
}

function makeRedis(): { redis: LangyStreamRedis; entries: RecordedEntry[] } {
  const entries: RecordedEntry[] = [];
  const redis: LangyStreamRedis = {
    xadd: async (_key, ...args) => {
      // Payload is the last arg (single `p` field).
      entries.push(JSON.parse(String(args[args.length - 1])) as RecordedEntry);
      return "1-1";
    },
    xrange: async () => [],
    expire: async () => 1,
    set: async () => "OK",
    get: async () => null,
  };
  return { redis, entries };
}

const ids = { conversationId: "conv_1", turnId: "turn_1" };
const deltas = (entries: RecordedEntry[]) =>
  entries.filter((entry) => entry.type === "delta");
const reasoning = (entries: RecordedEntry[]) =>
  entries.filter((entry) => entry.type === "reasoning");

describe("LangyTokenBuffer hybrid flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a turn that starts producing text", () => {
    describe("when the first delta arrives", () => {
      it("flushes it to the stream immediately, without waiting for a batch", async () => {
        const { redis, entries } = makeRedis();
        const buffer = new LangyTokenBuffer({ redis });

        await buffer.appendChunk({ ...ids, text: "Hello" });

        expect(deltas(entries)).toEqual([{ type: "delta", text: "Hello" }]);
      });
    });

    describe("when later tokens trickle in below the batch size", () => {
      it("flushes the pending text on the clock instead of holding it for the batch", async () => {
        const { redis, entries } = makeRedis();
        const buffer = new LangyTokenBuffer({ redis });

        await buffer.appendChunk({ ...ids, text: "Hello" }); // first flush
        await buffer.appendChunk({ ...ids, text: " there" });
        await buffer.appendChunk({ ...ids, text: " friend" });

        // Below CHUNK_TOKENS, so nothing flushed yet...
        expect(deltas(entries)).toHaveLength(1);

        // ...until the time arm fires.
        await vi.advanceTimersByTimeAsync(LANGY_STREAMING.FLUSH_AFTER_MS + 5);

        expect(deltas(entries)).toEqual([
          { type: "delta", text: "Hello" },
          { type: "delta", text: " there friend" },
        ]);
      });

      it("arms the clock once per pending batch, keeping stream write volume bounded", async () => {
        const { redis, entries } = makeRedis();
        const buffer = new LangyTokenBuffer({ redis });

        await buffer.appendChunk({ ...ids, text: "first" }); // immediate
        // A steady trickle across one FLUSH_AFTER_MS window.
        for (let i = 0; i < 10; i++) {
          await buffer.appendChunk({ ...ids, text: ` t${i}` });
          await vi.advanceTimersByTimeAsync(
            LANGY_STREAMING.FLUSH_AFTER_MS / 10,
          );
        }
        await vi.advanceTimersByTimeAsync(LANGY_STREAMING.FLUSH_AFTER_MS);

        // One immediate flush + at most a couple of timed flushes — never one
        // XADD per token.
        expect(deltas(entries).length).toBeLessThanOrEqual(3);
        // And nothing was lost: the concatenation is the full text.
        expect(
          deltas(entries)
            .map((d) => d.text)
            .join(""),
        ).toBe("first t0 t1 t2 t3 t4 t5 t6 t7 t8 t9");
      });
    });

    describe("when a fast stream fills the batch before the clock fires", () => {
      it("flushes on size and does not double-flush when the clock later fires", async () => {
        const { redis, entries } = makeRedis();
        const buffer = new LangyTokenBuffer({ redis });

        await buffer.appendChunk({ ...ids, text: "go" }); // immediate first flush
        const words = Array.from(
          { length: LANGY_STREAMING.CHUNK_TOKENS },
          (_, i) => `w${i}`,
        ).join(" ");
        await buffer.appendChunk({ ...ids, text: words });

        // Size arm flushed synchronously.
        expect(deltas(entries)).toHaveLength(2);

        // The armed timer was cleared by the flush — no empty third delta.
        await vi.advanceTimersByTimeAsync(LANGY_STREAMING.FLUSH_AFTER_MS * 2);
        expect(deltas(entries)).toHaveLength(2);
      });
    });

    describe("when the turn ends with tokens still pending", () => {
      it("drains the tail on the terminal marker, in order, before the end entry", async () => {
        const { redis, entries } = makeRedis();
        const buffer = new LangyTokenBuffer({ redis });

        await buffer.appendChunk({ ...ids, text: "first" });
        await buffer.appendChunk({ ...ids, text: " tail" });
        await buffer.markEnd(ids);

        expect(entries.map((entry) => entry.type)).toEqual([
          "delta",
          "delta",
          "end",
        ]);
        expect(deltas(entries).map((d) => d.text)).toEqual(["first", " tail"]);
      });
    });
  });

  describe("given a provider streams reasoning token by token", () => {
    it("coalesces the live-only reasoning tail, then drains it before the terminal marker", async () => {
      const { redis, entries } = makeRedis();
      const buffer = new LangyTokenBuffer({ redis });

      await buffer.appendReasoning({ ...ids, text: "I will " });
      await buffer.appendReasoning({ ...ids, text: "inspect this." });

      expect(reasoning(entries)).toEqual([]);
      await buffer.markEnd(ids);

      expect(reasoning(entries)).toEqual([
        { type: "reasoning", text: "I will inspect this." },
      ]);
      expect(entries.at(-1)?.type).toBe("end");
    });
  });
});
