import { describe, expect, it } from "vitest";
import { clonePayload } from "../payload-clone.rules.ts";

describe("clonePayload", () => {
  describe("given a payload the structured clone algorithm also handles", () => {
    const payloads: ReadonlyArray<readonly [string, unknown]> = [
      ["unicode and astral characters", { text: 'héllo \u{1F600} \\ " ünïcø∂e' }],
      ["control characters in a string", { text: "line\nbreak\ttab\u0000nul" }],
      ["nested null", { a: { b: null, c: [null, { d: null }] } }],
      ["numeric edges", { zero: 0, big: 1e308, small: 5e-324, int: -17 }],
      ["booleans and empty containers", { t: true, f: false, arr: [], obj: {} }],
      ["deeply nested arrays", { a: [[[[1, 2, 3]]]], b: [{ c: [{ d: [1] }] }] }],
      [
        "an OTLP-shaped span",
        {
          traceId: "EAAA",
          spanId: "IAAA",
          parentSpanId: "",
          name: "do-stream",
          kind: 3,
          startTimeUnixNano: "1756000000000000000",
          attributes: [
            { key: "gen_ai.request.model", value: { stringValue: "gpt-5" } },
            { key: "tokens", value: { intValue: "1200" } },
          ],
          events: [],
          links: [],
          status: { code: 1 },
        },
      ],
    ];

    it.each(payloads)("copies %s byte-identically to structuredClone", (_name, payload) => {
      expect(JSON.stringify(clonePayload(payload))).toBe(JSON.stringify(structuredClone(payload)));
    });
  });

  describe("when a key holds undefined", () => {
    it("keeps the key, as structuredClone does and a JSON round trip does not", () => {
      const cloned = clonePayload({ present: 1, absent: undefined });

      expect(Object.hasOwn(cloned, "absent")).toBe(true);
      expect(cloned.absent).toBeUndefined();
    });
  });

  describe("when a value is NaN", () => {
    it("carries it across, as structuredClone does", () => {
      const cloned = clonePayload({ value: Number.NaN });

      expect(Number.isNaN(cloned.value)).toBe(true);
    });
  });

  describe("when the payload carries a value with its own prototype", () => {
    it("hands a Date to structuredClone rather than copying its fields", () => {
      const at = new Date("2026-09-06T10:00:00.000Z");

      const cloned = clonePayload({ at });

      expect(cloned.at).toBeInstanceOf(Date);
      expect(cloned.at.toISOString()).toBe(at.toISOString());
      expect(cloned.at).not.toBe(at);
    });

    it("hands a typed array to structuredClone", () => {
      const bytes = new Uint8Array([1, 2, 3]);

      const cloned = clonePayload({ bytes });

      expect(cloned.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(cloned.bytes)).toEqual([1, 2, 3]);
    });
  });

  describe("when the caller mutates the copy", () => {
    it("leaves the original untouched at every depth", () => {
      const original = { a: { b: [{ c: 1 }] } };

      const cloned = clonePayload(original);
      cloned.a.b[0]!.c = 2;

      expect(original.a.b[0]!.c).toBe(1);
    });
  });
});
