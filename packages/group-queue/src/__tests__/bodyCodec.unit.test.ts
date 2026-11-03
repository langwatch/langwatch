import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { compress, decompress } from "../bodyCodec.ts";

const KIB = 1024;

/** Each body names the paths it takes: compress in-line up to 64 KiB, decompress up to 16 KiB. */
const BODIES = [
  { name: "small text (both in-line)", body: () => Buffer.from("a".repeat(8 * KIB)) },
  { name: "incompressible 40 KiB (in-line out, async back)", body: () => randomBytes(40 * KIB) },
  {
    name: "compressible 200 KiB (async out, in-line back)",
    body: () => Buffer.from("b".repeat(200 * KIB)),
  },
  { name: "incompressible 100 KiB (async both ways)", body: () => randomBytes(100 * KIB) },
  { name: "exactly 64 KiB", body: () => randomBytes(64 * KIB) },
] as const;

describe("bodyCodec", () => {
  describe.each(["gzip", "zstd"] as const)("given the %s codec", (codec) => {
    describe.each(BODIES)("when a $name body is compressed and decompressed", ({ body }) => {
      /** @scenario "A body round-trips whichever side of the in-line codec size it falls" */
      it("returns the bytes it started with", async () => {
        const original = body();
        const compressed = await compress(original, codec);
        expect(Buffer.compare(await decompress(compressed), original)).toBe(0);
      });
    });

    describe("when a multibyte text body is under 64 Ki characters but over 64 KiB", () => {
      /** @scenario "A body round-trips whichever side of the in-line codec size it falls" */
      it("returns the same text", async () => {
        const text = "é".repeat(40 * KIB);
        const compressed = await compress(text, codec);
        expect((await decompress(compressed)).toString("utf8")).toBe(text);
      });
    });
  });
});
