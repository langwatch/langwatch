import { describe, expect, it } from "vitest";
import type { OtlpResource, OtlpSpan } from "../../schemas/otlp";
import {
  capOversizedAttributes,
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
  hasOversizedAttribute,
  valueExceeds,
} from "../capOversizedAttributes";

function makeSpan(attributes: OtlpSpan["attributes"]): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes,
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

/** Builds a `data:image/png;base64,...` URL whose byte size exceeds the cap. */
function oversizedDataUrl(): string {
  const payload = "A".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1024);
  return `data:image/png;base64,${payload}`;
}

describe("capOversizedAttributes", () => {
  it("caps an oversized base64 data-url attribute and names the mime type", () => {
    const url = oversizedDataUrl();
    const span = makeSpan([
      { key: "langwatch.input", value: { stringValue: url } },
    ]);

    const cappedCount = capOversizedAttributes(span, null);

    expect(cappedCount).toBe(1);
    const value = span.attributes[0]!.value.stringValue!;
    expect(value).not.toContain("AAAA");
    expect(value).toMatch(/^\[truncated: \d+ bytes, image\/png\]$/);
    // Placeholder must be tiny, not multi-MB.
    expect(value.length).toBeLessThan(64);
  });

  it("leaves a normal small span completely unchanged", () => {
    const span = makeSpan([
      { key: "langwatch.input", value: { stringValue: "hello world" } },
      {
        key: "langwatch.output",
        value: {
          stringValue: JSON.stringify({ role: "assistant", content: "hi" }),
        },
      },
    ]);
    const before = structuredClone(span.attributes);

    const cappedCount = capOversizedAttributes(span, null);

    expect(cappedCount).toBe(0);
    expect(span.attributes).toEqual(before);
  });

  it("caps oversized strings nested inside arrayValue and kvlistValue", () => {
    const big = "x".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1);
    const span = makeSpan([
      {
        key: "langwatch.params",
        value: {
          kvlistValue: {
            values: [
              { key: "image", value: { stringValue: big } },
              { key: "small", value: { stringValue: "ok" } },
            ],
          },
        },
      },
      {
        key: "langwatch.input",
        value: {
          arrayValue: {
            values: [{ stringValue: big }, { stringValue: "fine" }],
          },
        },
      },
    ]);

    const cappedCount = capOversizedAttributes(span, null);

    expect(cappedCount).toBe(2);
    const kv = span.attributes[0]!.value.kvlistValue!.values;
    expect(kv[0]!.value.stringValue).toMatch(/^\[truncated: \d+ bytes\]$/);
    expect(kv[1]!.value.stringValue).toBe("ok");
    const arr = span.attributes[1]!.value.arrayValue!.values;
    expect(arr[0]!.stringValue).toMatch(/^\[truncated: \d+ bytes\]$/);
    expect(arr[1]!.stringValue).toBe("fine");
  });

  it("caps oversized bytesValue payloads", () => {
    const span = makeSpan([
      {
        key: "langwatch.input",
        value: {
          bytesValue: new Uint8Array(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1),
        },
      },
    ]);

    const cappedCount = capOversizedAttributes(span, null);

    expect(cappedCount).toBe(1);
    expect(span.attributes[0]!.value.bytesValue).toBeNull();
    expect(span.attributes[0]!.value.stringValue).toMatch(
      /^\[truncated: \d+ bytes\]$/,
    );
  });

  it("caps oversized values in events, links, and the resource", () => {
    const big = "y".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1);
    const span = makeSpan([]);
    span.events = [
      {
        timeUnixNano: { low: 0, high: 0 },
        name: "evt",
        attributes: [{ key: "big", value: { stringValue: big } }],
      },
    ] as unknown as OtlpSpan["events"];
    span.links = [
      {
        traceId: "t",
        spanId: "s",
        attributes: [{ key: "big", value: { stringValue: big } }],
        droppedAttributesCount: 0,
      },
    ] as unknown as OtlpSpan["links"];
    const resource = {
      attributes: [{ key: "big", value: { stringValue: big } }],
    };

    const cappedCount = capOversizedAttributes(span, resource as never);

    expect(cappedCount).toBe(3);
  });

  it("does not throw on malformed attribute shapes", () => {
    const span = makeSpan([
      { key: "weird", value: null as never },
      undefined as never,
    ]);

    expect(() => capOversizedAttributes(span, null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// valueExceeds
// ---------------------------------------------------------------------------

describe("valueExceeds", () => {
  describe("given a stringValue", () => {
    describe("when the string exceeds maxBytes", () => {
      it("returns true", () => {
        const value = { stringValue: "a".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1) };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(true);
      });
    });

    describe("when the string is exactly at the limit", () => {
      it("returns false", () => {
        const value = { stringValue: "a".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES) };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(false);
      });
    });

    describe("when the string is small", () => {
      it("returns false", () => {
        const value = { stringValue: "hello" };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(false);
      });
    });
  });

  describe("given a bytesValue", () => {
    describe("when the Uint8Array exceeds maxBytes", () => {
      it("returns true", () => {
        const value = { bytesValue: new Uint8Array(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1) };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(true);
      });
    });

    describe("when the Uint8Array is exactly at the limit", () => {
      it("returns false", () => {
        const value = { bytesValue: new Uint8Array(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES) };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(false);
      });
    });
  });

  describe("given a value nested inside arrayValue", () => {
    describe("when a nested stringValue exceeds maxBytes", () => {
      it("returns true", () => {
        const value = {
          arrayValue: {
            values: [
              { stringValue: "small" },
              { stringValue: "x".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1) },
            ],
          },
        };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(true);
      });
    });

    describe("when all nested stringValues are small", () => {
      it("returns false", () => {
        const value = {
          arrayValue: {
            values: [
              { stringValue: "a" },
              { stringValue: "b" },
            ],
          },
        };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(false);
      });
    });
  });

  describe("given a value nested inside kvlistValue", () => {
    describe("when a nested entry value exceeds maxBytes", () => {
      it("returns true", () => {
        const value = {
          kvlistValue: {
            values: [
              { key: "small", value: { stringValue: "ok" } },
              { key: "big", value: { stringValue: "z".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1) } },
            ],
          },
        };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(true);
      });
    });

    describe("when all nested entry values are small", () => {
      it("returns false", () => {
        const value = {
          kvlistValue: {
            values: [
              { key: "a", value: { stringValue: "alpha" } },
              { key: "b", value: { stringValue: "beta" } },
            ],
          },
        };
        expect(valueExceeds(value, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(false);
      });
    });
  });

  describe("given null or undefined", () => {
    it("returns false for null", () => {
      expect(valueExceeds(null, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(valueExceeds(undefined, DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// hasOversizedAttribute
// ---------------------------------------------------------------------------

describe("hasOversizedAttribute", () => {
  const big = "b".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1);
  const small = "small";

  describe("given a span with all small attributes and no resource", () => {
    describe("when hasOversizedAttribute is called", () => {
      it("returns false", () => {
        const span = makeSpan([
          { key: "custom.attr", value: { stringValue: small } },
        ]);
        expect(hasOversizedAttribute(span, null)).toBe(false);
      });
    });
  });

  describe("given a span with an oversized value in span.attributes", () => {
    describe("when hasOversizedAttribute is called", () => {
      it("returns true", () => {
        const span = makeSpan([
          { key: "custom.attr", value: { stringValue: big } },
        ]);
        expect(hasOversizedAttribute(span, null)).toBe(true);
      });
    });
  });

  describe("given a span with an oversized value only in span.events[].attributes", () => {
    describe("when hasOversizedAttribute is called", () => {
      it("returns true", () => {
        const span = makeSpan([]);
        span.events = [
          {
            timeUnixNano: { low: 0, high: 0 },
            name: "evt",
            attributes: [{ key: "event.attr", value: { stringValue: big } }],
          },
        ] as unknown as OtlpSpan["events"];

        expect(hasOversizedAttribute(span, null)).toBe(true);
      });
    });
  });

  describe("given a span with an oversized value only in span.links[].attributes", () => {
    describe("when hasOversizedAttribute is called", () => {
      it("returns true", () => {
        const span = makeSpan([]);
        span.links = [
          {
            traceId: "t",
            spanId: "s",
            attributes: [{ key: "link.attr", value: { stringValue: big } }],
            droppedAttributesCount: 0,
          },
        ] as unknown as OtlpSpan["links"];

        expect(hasOversizedAttribute(span, null)).toBe(true);
      });
    });
  });

  describe("given a span with all small span attributes but an oversized value in resource.attributes", () => {
    describe("when hasOversizedAttribute is called", () => {
      it("returns true", () => {
        const span = makeSpan([
          { key: "custom.small", value: { stringValue: small } },
        ]);
        const resource: OtlpResource = {
          attributes: [{ key: "service.name", value: { stringValue: big } }],
        } as unknown as OtlpResource;

        expect(hasOversizedAttribute(span, resource)).toBe(true);
      });
    });
  });

  describe("given a span with an oversized value nested inside an arrayValue in span.attributes", () => {
    describe("when hasOversizedAttribute is called", () => {
      it("returns true", () => {
        const span = makeSpan([
          {
            key: "nested.attr",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "small" },
                  { stringValue: big },
                ],
              },
            },
          },
        ]);

        expect(hasOversizedAttribute(span, null)).toBe(true);
      });
    });
  });

  describe("given a span with an oversized value nested inside a kvlistValue in span.events[].attributes", () => {
    describe("when hasOversizedAttribute is called", () => {
      it("returns true", () => {
        const span = makeSpan([]);
        span.events = [
          {
            timeUnixNano: { low: 0, high: 0 },
            name: "evt",
            attributes: [
              {
                key: "nested.kv",
                value: {
                  kvlistValue: {
                    values: [
                      { key: "inner", value: { stringValue: big } },
                    ],
                  },
                },
              },
            ],
          },
        ] as unknown as OtlpSpan["events"];

        expect(hasOversizedAttribute(span, null)).toBe(true);
      });
    });
  });

  describe("given null as resource", () => {
    describe("when hasOversizedAttribute is called with all-small span", () => {
      it("returns false without throwing", () => {
        const span = makeSpan([{ key: "a", value: { stringValue: "x" } }]);
        expect(() => hasOversizedAttribute(span, null)).not.toThrow();
        expect(hasOversizedAttribute(span, null)).toBe(false);
      });
    });
  });
});
