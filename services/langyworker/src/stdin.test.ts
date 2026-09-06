import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { attachJsonlReader } from "./stdin.js";

function makeSource() {
  const emitter = new EventEmitter();
  const lines: string[] = [];
  let hasEnded = false;
  attachJsonlReader({
    stream: emitter as never,
    onLine: (line) => lines.push(line),
    onEnd: () => {
      hasEnded = true;
    },
  });
  return {
    push: (chunk: string | Buffer) => emitter.emit("data", chunk),
    end: () => emitter.emit("end"),
    lines,
    isEnded: () => hasEnded,
  };
}

describe("attachJsonlReader", () => {
  describe("when a record arrives split across chunks", () => {
    it("reassembles it on the LF boundary", () => {
      const source = makeSource();
      source.push('{"type":"pi');
      source.push('ng"}\n{"a":1}\n');
      expect(source.lines).toEqual(['{"type":"ping"}', '{"a":1}']);
    });
  });

  describe("when records use CRLF", () => {
    it("strips the trailing CR", () => {
      const source = makeSource();
      source.push('{"a":1}\r\n');
      expect(source.lines).toEqual(['{"a":1}']);
    });
  });

  describe("when a JSON string contains U+2028/U+2029", () => {
    it("does not split on them (readline would)", () => {
      const source = makeSource();
      const line = `{"text":"a b c"}`;
      source.push(`${line}\n`);
      expect(source.lines).toEqual([line]);
      expect(JSON.parse(source.lines[0] as string)).toEqual({ text: "a b c" });
    });
  });

  describe("when a multi-byte character straddles two Buffer chunks", () => {
    it("decodes it correctly", () => {
      const source = makeSource();
      const encoded = Buffer.from('{"t":"é"}\n', "utf8");
      source.push(encoded.subarray(0, 7));
      source.push(encoded.subarray(7));
      expect(source.lines).toEqual(['{"t":"é"}']);
    });
  });

  describe("when the stream ends with an unterminated line", () => {
    it("emits the tail and then signals end", () => {
      const source = makeSource();
      source.push('{"tail":true}');
      source.end();
      expect(source.lines).toEqual(['{"tail":true}']);
      expect(source.isEnded()).toBe(true);
    });
  });

  describe("when empty lines arrive", () => {
    it("skips them", () => {
      const source = makeSource();
      source.push('\n\n{"a":1}\n\n');
      expect(source.lines).toEqual(['{"a":1}']);
    });
  });
});
