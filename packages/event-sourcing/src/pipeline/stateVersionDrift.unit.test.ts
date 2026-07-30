import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkStateVersionDrift } from "./ratchet";
import { resolveStateVersion } from "./stateVersion";

const hashOf = (schema: z.ZodTypeAny, pinned?: string) =>
  resolveStateVersion({ schema, pinned });

describe("checkStateVersionDrift", () => {
  describe("given a pinned accumulator whose state schema changed", () => {
    /** @scenario changing what a fold stores without moving its stamp fails the build */
    it("reports drift, naming the pin and both hashes", () => {
      const before = hashOf(z.object({ total: z.number() }), "2026-07-15");
      const after = hashOf(
        z.object({ total: z.number(), watermark: z.number() }),
        "2026-07-15",
      );

      const drifted = checkStateVersionDrift({
        snapshot: { "langy/turn": before },
        current: { "langy/turn": after },
      });

      expect(drifted).toEqual([
        {
          accumulator: "langy/turn",
          version: "2026-07-15",
          committedHash: before.schemaHash,
          currentHash: after.schemaHash,
        },
      ]);
    });

    it("does not report it once the pin is deliberately re-stamped", () => {
      const before = hashOf(z.object({ total: z.number() }), "2026-07-15");
      const after = hashOf(
        z.object({ total: z.number(), watermark: z.number() }),
        "2026-07-30",
      );

      expect(
        checkStateVersionDrift({
          snapshot: { "langy/turn": before },
          current: { "langy/turn": after },
        }),
      ).toEqual([]);
    });
  });

  describe("given a pinned accumulator whose schema is unchanged", () => {
    it("reports nothing, so a passing check does not churn the snapshot", () => {
      const stamp = hashOf(z.object({ total: z.number() }), "2026-07-15");
      expect(
        checkStateVersionDrift({
          snapshot: { "langy/turn": stamp },
          current: { "langy/turn": stamp },
        }),
      ).toEqual([]);
    });

    it("ignores a change that is documentation rather than shape", () => {
      const before = hashOf(z.object({ total: z.number() }), "2026-07-15");
      const after = hashOf(
        z.object({ total: z.number().describe("how many landed") }),
        "2026-07-15",
      );
      expect(before.schemaHash).toBe(after.schemaHash);
      expect(
        checkStateVersionDrift({
          snapshot: { "langy/turn": before },
          current: { "langy/turn": after },
        }),
      ).toEqual([]);
    });
  });

  describe("given an accumulator the snapshot has never seen", () => {
    it("reports nothing, because a new fold has no stored rows to strand", () => {
      expect(
        checkStateVersionDrift({
          snapshot: {},
          current: { "langy/turn": hashOf(z.object({ a: z.string() })) },
        }),
      ).toEqual([]);
    });
  });

  describe("given an unpinned accumulator whose schema changed", () => {
    it("reports nothing, because the derived stamp moved with the shape", () => {
      const before = hashOf(z.object({ a: z.string() }));
      const after = hashOf(z.object({ a: z.string(), b: z.number() }));
      expect(before.version).not.toBe(after.version);
      expect(
        checkStateVersionDrift({
          snapshot: { "trace/summary": before },
          current: { "trace/summary": after },
        }),
      ).toEqual([]);
    });
  });
});
