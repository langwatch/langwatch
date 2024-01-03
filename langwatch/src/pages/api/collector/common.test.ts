import { describe, it, expect } from "vitest";
import {
  organizeSpansIntoTree,
  flattenSpanTree,
  getFirstInputAsText,
  getLastOutputAsText,
} from "./common"; // replace with your actual module path
import type { BaseSpan } from "../../../server/tracer/types";

describe("Span organizing and flattening tests", () => {
  const commonSpanProps = {
    type: "span" as BaseSpan["type"],
    trace_id: "trace_foo_bar",
    input: { type: "text", value: "random input" } as BaseSpan["input"],
    outputs: [{ type: "text", value: "random output" }] as BaseSpan["outputs"],
  };

  const spans: BaseSpan[] = [
    // Top level spans
    {
      ...commonSpanProps,
      id: "1",
      parent_id: null,
      timestamps: { started_at: 100, finished_at: 500 },
      input: { type: "text", value: "topmost input" },
    },
    {
      ...commonSpanProps,
      id: "2",
      parent_id: null,
      timestamps: { started_at: 200, finished_at: 600 },
      outputs: [{ type: "text", value: "bottommost output" }],
    },

    // Children of span 1
    {
      ...commonSpanProps,
      id: "1-2",
      parent_id: "1",
      timestamps: { started_at: 300, finished_at: 700 },
    },
    {
      ...commonSpanProps,
      id: "1-1",
      parent_id: "1",
      timestamps: { started_at: 150, finished_at: 450 },
    },

    // Children of span 2
    {
      ...commonSpanProps,
      id: "2-1",
      parent_id: "2",
      timestamps: { started_at: 250, finished_at: 550 },
    },

    // Child of span 1-2 (nested child)
    {
      ...commonSpanProps,
      id: "1-2-1",
      parent_id: "1-2",
      timestamps: { started_at: 350, finished_at: 375 },
    },
  ];

  it("should organize spans into a parent-child hierarchy", () => {
    const organized = organizeSpansIntoTree(spans);
    expect(organized.length).toBe(2); // Two top level spans
    expect(organized[0]?.id).toBe("1");
    expect(organized[1]?.id).toBe("2");
    expect(organized[0]?.children.length).toBe(2); // Two children for span 1
    expect(organized[0]?.children[0]?.id).toBe("1-1");
    expect(organized[0]?.children[1]?.id).toBe("1-2");
    expect(organized[0]?.children[1]?.children.length).toBe(1); // One nested child
    expect(organized[0]?.children[1]?.children[0]?.id).toBe("1-2-1");
  });

  it("should flatten spans in finishing order inside-out", () => {
    const organized = organizeSpansIntoTree(spans);
    const flattened = flattenSpanTree(organized, "inside-out");
    expect(flattened.length).toBe(6);
    expect(flattened[0]?.id).toBe("1-2-1"); // Deepest child of the topmost span with the last started_at
    expect(flattened[5]?.id).toBe("2"); // Last span should be the topmost parent with the last started_at
  });

  it("should flatten spans in finishing order outside-in", () => {
    const organized = organizeSpansIntoTree(spans);
    const flattened = flattenSpanTree(organized, "outside-in");
    expect(flattened.length).toBe(6);
    expect(flattened[0]?.id).toBe("1"); // Topmost span with the first started_at
    expect(flattened[5]?.id).toBe("2-1"); // Deepest child of the last topmost span with the last started_at
  });

  it("should get the very first input as text", () => {
    const input = getFirstInputAsText(spans.sort(() => 0.5 - Math.random()));
    expect(input).toBe("topmost input");
  });

  it("should get the very last output as text", () => {
    const output = getLastOutputAsText(spans.sort(() => 0.5 - Math.random()));
    expect(output).toBe("bottommost output");
  });
});
