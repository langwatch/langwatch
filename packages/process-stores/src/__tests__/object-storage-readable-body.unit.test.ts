import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { readableBody } from "../members.ts";

async function* bytes(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield Buffer.from(part);
}

describe("readableBody()", () => {
  describe("when the body is already a Node stream", () => {
    /** @scenario "A byte read hands over storage's own stream" */
    it("hands back that same stream, so stopping it reaches the connection behind it", () => {
      const body = Readable.from([Buffer.from("abc")]);

      expect(readableBody(body)).toBe(body);
    });
  });

  describe("when the body is any other async iterable", () => {
    it("streams its bytes in order as a byte-mode stream", async () => {
      const stream = readableBody(bytes("ab", "c"));
      const read: Buffer[] = [];
      for await (const chunk of stream) read.push(Buffer.from(chunk as Uint8Array));

      expect(stream.readableObjectMode).toBe(false);
      expect(Buffer.concat(read).toString("utf8")).toBe("abc");
    });
  });
});
