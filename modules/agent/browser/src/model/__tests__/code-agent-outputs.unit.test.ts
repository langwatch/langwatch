import { describe, expect, it } from "vitest";

import { offeredOutputTypes, outputsFromEditor } from "../code-agent-outputs.ts";

describe("offeredOutputTypes", () => {
  it("offers the code output types and a JSON schema", () => {
    expect(offeredOutputTypes([{ identifier: "output", type: "str" }])).toEqual([
      "str",
      "float",
      "bool",
      "json_schema",
      "dict",
      "list",
      "image",
    ]);
  });

  it("also offers a type a stored output already has", () => {
    expect(offeredOutputTypes([{ identifier: "chat", type: "chat_messages" }])).toContain(
      "chat_messages",
    );
  });
});

describe("outputsFromEditor", () => {
  const previous = [
    { identifier: "answer", type: "str" as const, desc: "The reply" },
    { identifier: "score", type: "float" as const },
  ];

  it("keeps the keys the editor does not show on a retyped output", () => {
    const next = [
      { identifier: "answer", type: "dict" as const },
      { identifier: "score", type: "float" as const },
    ];

    expect(outputsFromEditor({ previous, next })).toEqual([
      { identifier: "answer", type: "dict", desc: "The reply" },
      { identifier: "score", type: "float" },
    ]);
  });

  it("keeps them through a rename, by position", () => {
    const next = [
      { identifier: "reply", type: "str" as const },
      { identifier: "score", type: "float" as const },
    ];

    expect(outputsFromEditor({ previous, next })[0]).toEqual({
      identifier: "reply",
      type: "str",
      desc: "The reply",
    });
  });

  it("adds a new output with only what the editor reports", () => {
    const next = [...previous, { identifier: "output", type: "list" as const }];

    expect(outputsFromEditor({ previous, next })[2]).toEqual({
      identifier: "output",
      type: "list",
    });
  });

  it("keeps a JSON schema only on a JSON schema output", () => {
    const schema = { type: "object", properties: {} };
    const asSchema = outputsFromEditor({
      previous,
      next: [{ identifier: "answer", type: "json_schema", json_schema: schema }],
    });
    const retyped = outputsFromEditor({
      previous: asSchema,
      next: [{ identifier: "answer", type: "str", json_schema: schema }],
    });

    expect(asSchema[0]).toEqual({
      identifier: "answer",
      type: "json_schema",
      desc: "The reply",
      json_schema: schema,
    });
    expect(retyped[0]).toEqual({ identifier: "answer", type: "str", desc: "The reply" });
  });
});
