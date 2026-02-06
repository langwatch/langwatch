import { describe, expect, it } from "vitest";
import {
  buildMetadataFieldChildren,
  buildSpanFieldChildren,
  extractTracesFields,
  SPAN_SUBFIELDS,
  THREAD_MAPPINGS,
  TRACE_MAPPINGS,
} from "../tracesMapping";

describe("SPAN_SUBFIELDS", () => {
  it("contains * (full span object) as first option", () => {
    expect(SPAN_SUBFIELDS[0]).toEqual({
      name: "*",
      label: "* (full span object)",
      type: "dict",
    });
  });

  it("contains standard span fields", () => {
    const fieldNames = SPAN_SUBFIELDS.map((f) => f.name);
    expect(fieldNames).toContain("input");
    expect(fieldNames).toContain("output");
    expect(fieldNames).toContain("params");
    expect(fieldNames).toContain("contexts");
  });

  it("has correct types for each field", () => {
    const inputField = SPAN_SUBFIELDS.find((f) => f.name === "input");
    const outputField = SPAN_SUBFIELDS.find((f) => f.name === "output");
    const paramsField = SPAN_SUBFIELDS.find((f) => f.name === "params");
    const contextsField = SPAN_SUBFIELDS.find((f) => f.name === "contexts");

    expect(inputField?.type).toBe("str");
    expect(outputField?.type).toBe("str");
    expect(paramsField?.type).toBe("dict");
    expect(contextsField?.type).toBe("list");
  });
});

describe("buildSpanFieldChildren", () => {
  it("returns * (any span) as first option when no span names provided", () => {
    const result = buildSpanFieldChildren([]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "*",
      label: "* (any span)",
      type: "dict",
      children: SPAN_SUBFIELDS,
    });
  });

  it("includes dynamic span names after * (any span)", () => {
    const spanNames = [
      { key: "openai/gpt-4", label: "openai/gpt-4" },
      { key: "my-custom-span", label: "my-custom-span" },
    ];

    const result = buildSpanFieldChildren(spanNames);

    expect(result).toHaveLength(3);
    expect(result[0]?.label).toBe("* (any span)");
    expect(result[0]?.name).toBe("*");
    expect(result[1]?.name).toBe("openai/gpt-4");
    expect(result[1]?.label).toBe("openai/gpt-4");
    expect(result[2]?.name).toBe("my-custom-span");
  });

  it("each span name has SPAN_SUBFIELDS as children", () => {
    const spanNames = [{ key: "test-span", label: "Test Span" }];

    const result = buildSpanFieldChildren(spanNames);

    // * (any span) should have subfields
    expect(result[0]?.children).toEqual(SPAN_SUBFIELDS);
    // Named span should also have subfields
    expect(result[1]?.children).toEqual(SPAN_SUBFIELDS);
  });

  it("all entries have type dict", () => {
    const spanNames = [
      { key: "span-1", label: "Span 1" },
      { key: "span-2", label: "Span 2" },
    ];

    const result = buildSpanFieldChildren(spanNames);

    result.forEach((entry) => {
      expect(entry.type).toBe("dict");
    });
  });

  it("preserves span labels from input", () => {
    const spanNames = [{ key: "openai/gpt-4o", label: "GPT-4o Model" }];

    const result = buildSpanFieldChildren(spanNames);

    expect(result[1]?.name).toBe("openai/gpt-4o");
    expect(result[1]?.label).toBe("GPT-4o Model");
  });
});

describe("buildMetadataFieldChildren", () => {
  it("returns * (any key) as first option when no metadata keys provided", () => {
    const result = buildMetadataFieldChildren([]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "*",
      label: "* (any key)",
      type: "str",
    });
  });

  it("includes dynamic metadata keys after * (any key)", () => {
    const metadataKeys = [
      { key: "user_id", label: "user_id" },
      { key: "custom_field", label: "custom_field" },
    ];

    const result = buildMetadataFieldChildren(metadataKeys);

    expect(result).toHaveLength(3);
    expect(result[0]?.label).toBe("* (any key)");
    expect(result[0]?.name).toBe("*");
    expect(result[1]?.name).toBe("user_id");
    expect(result[2]?.name).toBe("custom_field");
  });

  it("labels field has type list, others have type str", () => {
    const metadataKeys = [
      { key: "user_id", label: "user_id" },
      { key: "labels", label: "labels" },
    ];

    const result = buildMetadataFieldChildren(metadataKeys);

    const userIdField = result.find((f) => f.name === "user_id");
    const labelsField = result.find((f) => f.name === "labels");

    expect(userIdField?.type).toBe("str");
    expect(labelsField?.type).toBe("list");
  });
});

describe("TRACE_MAPPINGS.spans.mapping", () => {
  const mockTrace = {
    trace_id: "trace-1",
    timestamps: { started_at: Date.now() },
    spans: [
      {
        span_id: "span-1",
        name: "openai/gpt-4",
        type: "llm",
        input: { type: "text", value: "Hello" },
        output: { type: "text", value: "Hi there" },
        params: { temperature: 0.7 },
        contexts: [],
      },
      {
        span_id: "span-2",
        name: "my-custom-span",
        type: "span",
        input: { type: "text", value: "Input 2" },
        output: { type: "text", value: "Output 2" },
        params: {},
        contexts: [{ content: "Context 1" }],
      },
    ],
  };

  it("returns all spans when key is empty", () => {
    const result = TRACE_MAPPINGS.spans.mapping(mockTrace as any, "", "");

    expect(result).toHaveLength(2);
  });

  it("returns all spans when key is * (any span wildcard)", () => {
    const result = TRACE_MAPPINGS.spans.mapping(mockTrace as any, "*", "");

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "openai/gpt-4" }),
        expect.objectContaining({ name: "my-custom-span" }),
      ])
    );
  });

  it("filters spans by specific name", () => {
    const result = TRACE_MAPPINGS.spans.mapping(
      mockTrace as any,
      "openai/gpt-4",
      ""
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ name: "openai/gpt-4" }));
  });

  it("returns input field from all spans when key is * and subkey is input", () => {
    const result = TRACE_MAPPINGS.spans.mapping(mockTrace as any, "*", "input");

    expect(result).toHaveLength(2);
    // input field is an object with { type, value }
    expect(result).toEqual([
      { type: "text", value: "Hello" },
      { type: "text", value: "Input 2" },
    ]);
  });

  it("returns full span objects when key is * and subkey is * (full span object wildcard)", () => {
    const result = TRACE_MAPPINGS.spans.mapping(mockTrace as any, "*", "*");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        name: "openai/gpt-4",
        input: { type: "text", value: "Hello" },
        output: { type: "text", value: "Hi there" },
      })
    );
  });

  it("returns specific field from specific span", () => {
    const result = TRACE_MAPPINGS.spans.mapping(
      mockTrace as any,
      "openai/gpt-4",
      "output"
    );

    expect(result).toHaveLength(1);
    // output field is an object with { type, value }
    expect(result[0]).toEqual({ type: "text", value: "Hi there" });
  });

  it("returns full span object when key is specific and subkey is *", () => {
    const result = TRACE_MAPPINGS.spans.mapping(
      mockTrace as any,
      "my-custom-span",
      "*"
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        name: "my-custom-span",
        input: { type: "text", value: "Input 2" },
        output: { type: "text", value: "Output 2" },
      })
    );
  });
});

describe("TRACE_MAPPINGS.metadata.mapping", () => {
  const mockTrace = {
    trace_id: "trace-1",
    timestamps: { started_at: Date.now() },
    metadata: {
      user_id: "user-123",
      custom_field: "custom-value",
      labels: ["label1", "label2"],
    },
  };

  it("returns full metadata object when key is empty", () => {
    const result = TRACE_MAPPINGS.metadata.mapping(mockTrace as any, "");

    expect(result).toBe(JSON.stringify(mockTrace.metadata));
  });

  it("returns full metadata object when key is * (any key wildcard)", () => {
    const result = TRACE_MAPPINGS.metadata.mapping(mockTrace as any, "*");

    expect(result).toEqual(mockTrace.metadata);
  });

  it("returns specific metadata field", () => {
    const result = TRACE_MAPPINGS.metadata.mapping(mockTrace as any, "user_id");

    expect(result).toBe("user-123");
  });

  it("returns labels array when key is labels", () => {
    const result = TRACE_MAPPINGS.metadata.mapping(mockTrace as any, "labels");

    expect(result).toEqual(["label1", "label2"]);
  });

  it("returns undefined for non-existent key", () => {
    const result = TRACE_MAPPINGS.metadata.mapping(
      mockTrace as any,
      "non_existent"
    );

    expect(result).toBeUndefined();
  });
});

describe("extractTracesFields", () => {
  const mockTraces = [
    {
      trace_id: "trace-1",
      timestamps: { started_at: Date.now() },
      input: { type: "text", value: "Hello" },
      output: { type: "text", value: "World" },
      metadata: { thread_id: "thread-1" },
    },
    {
      trace_id: "trace-2",
      timestamps: { started_at: Date.now() },
      input: { type: "text", value: "Foo" },
      output: { type: "text", value: "Bar" },
      metadata: { thread_id: "thread-1" },
    },
  ] as any[];

  it("extracts default fields (trace_id, input, output) when no selectedFields provided", () => {
    const result = extractTracesFields(mockTraces, []);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      trace_id: "trace-1",
      input: "Hello",
      output: "World",
    });
    expect(result[1]).toEqual({
      trace_id: "trace-2",
      input: "Foo",
      output: "Bar",
    });
  });

  it("extracts only specified fields when selectedFields provided", () => {
    const result = extractTracesFields(mockTraces, ["input"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ input: "Hello" });
    expect(result[1]).toEqual({ input: "Foo" });
  });

  it("extracts multiple specified fields", () => {
    const result = extractTracesFields(mockTraces, ["input", "output"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ input: "Hello", output: "World" });
    expect(result[1]).toEqual({ input: "Foo", output: "Bar" });
  });
});

describe("THREAD_MAPPINGS", () => {
  const mockThread = {
    thread_id: "thread-1",
    traces: [
      {
        trace_id: "trace-1",
        timestamps: { started_at: Date.now() },
        input: { type: "text", value: "Hello" },
        output: { type: "text", value: "World" },
      },
    ] as any[],
  };

  it("thread_id mapping returns the thread id", () => {
    expect(THREAD_MAPPINGS.thread_id.mapping(mockThread)).toBe("thread-1");
  });

  it("traces mapping with no selectedFields returns traces with default fields", () => {
    const result = THREAD_MAPPINGS.traces.mapping(mockThread);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("trace_id", "trace-1");
    expect(result[0]).toHaveProperty("input", "Hello");
    expect(result[0]).toHaveProperty("output", "World");
  });

  it("traces mapping with selectedFields returns only those fields", () => {
    const result = THREAD_MAPPINGS.traces.mapping(mockThread, ["input"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ input: "Hello" });
  });
});
