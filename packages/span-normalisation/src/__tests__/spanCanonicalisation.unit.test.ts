import { describe, expect, it } from "vitest";

import type { AttributeCanonicaliser } from "../canonicalAttributes.ts";
import type { CanonicalSpanContext } from "../canonicalTypes.ts";
import {
  canonicaliseLogRecord,
  canonicaliseSpanAttributes,
  orderedSpanCanonicalisers,
} from "../spanCanonicalisation.ts";

const span: CanonicalSpanContext = {
  name: "chat",
  kind: null,
  instrumentationScope: { name: "test" },
  statusMessage: null,
  statusCode: null,
  parentSpanId: null,
};

const codexScopes = { isCodexScope: () => false, execScope: "codex_exec" };

const recorder = ({ id, key, value }: { id: string; key: string; value: unknown }) =>
  ({
    id,
    apply: ({ setAttrIfAbsent, recordRule }) => {
      setAttrIfAbsent(key, value);
      recordRule(id);
    },
    applyLog: ({ setAttrIfAbsent, recordRule }) => {
      setAttrIfAbsent(key, value);
      recordRule(id);
    },
  }) satisfies AttributeCanonicaliser;

describe("canonicaliseSpanAttributes()", () => {
  it("keeps the first canonicaliser's value and records rules in order", () => {
    const result = canonicaliseSpanAttributes({
      canonicalisers: [
        recorder({ id: "first", key: "langwatch.model", value: "a" }),
        recorder({ id: "second", key: "langwatch.model", value: "b" }),
      ],
      spanAttributes: { other: "kept" },
      events: [],
      span,
    });

    expect(result).toEqual({
      attributes: { other: "kept", "langwatch.model": "a" },
      events: [],
      appliedRules: ["first", "second"],
    });
  });

  it("yields to a value the emitter already sent under the canonical key", () => {
    const result = canonicaliseSpanAttributes({
      canonicalisers: [recorder({ id: "r", key: "langwatch.model", value: "derived" })],
      spanAttributes: { "langwatch.model": "sent" },
      events: [],
      span,
    });

    expect(result.attributes).toEqual({ "langwatch.model": "sent" });
  });

  it("parses JSON-string attribute values before the canonicalisers run", () => {
    const result = canonicaliseSpanAttributes({
      canonicalisers: [],
      spanAttributes: { payload: '{"a":1}' },
      events: [],
      span,
    });

    expect(result.attributes).toEqual({ payload: { a: 1 } });
  });
});

describe("canonicaliseLogRecord()", () => {
  it("returns only what the canonicalisers wrote", () => {
    const result = canonicaliseLogRecord({
      canonicalisers: [recorder({ id: "r", key: "langwatch.model", value: "m" })],
      scopeName: "gen_ai",
      body: "",
      attributes: { untouched: "x" },
    });

    expect(result).toEqual({ attributes: { "langwatch.model": "m" }, appliedRules: ["r"] });
  });

  it("lifts gen_ai fields through the ordered canonicalisers", () => {
    const result = canonicaliseLogRecord({
      canonicalisers: orderedSpanCanonicalisers({ codexScopes }),
      scopeName: "gen_ai",
      body: "",
      attributes: { "gen_ai.request.model": "gemini-2.0-flash" },
    });

    expect(result.attributes["langwatch.model"]).toBe("gemini-2.0-flash");
  });
});

describe("orderedSpanCanonicalisers()", () => {
  it("runs all sixteen canonicalisers, the fallback last", () => {
    const ids = orderedSpanCanonicalisers({ codexScopes }).map(({ id }) => id);

    expect(ids).toHaveLength(16);
    expect(ids.at(-1)).toBe("fallback");
  });
});
