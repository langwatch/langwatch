import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../schemas/otlp";
import {
  capOversizedAttributes,
  DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
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
