import { describe, expect, it } from "vitest";
import { z } from "zod/mini";

import { operationSchema } from "../model/operation-schema.ts";

const operation = ({
  schema,
  origin = "https://app.langwatch.ai",
}: {
  schema: unknown;
  origin?: string;
}) => ({
  method: "POST",
  path: "/api/traces",
  origin,
  summary: "Create a trace",
  description: "",
  deprecated: false,
  schemes: [{ id: "api_key", type: "apiKey", in: "header", name: "X-Auth-Token" }],
  parameters: [],
  body: { required: true, description: "", contents: [{ type: "application/json", schema }] },
  responses: [{ status: "204", description: "No content", contents: [] }],
});

const recursive = {
  type: "object",
  required: ["spans"],
  properties: {
    spans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          children: { type: "array", items: { $recursive: "Span" } },
          kind: { type: "string", title: "Span kind", const: "llm" },
        },
        additionalProperties: { type: ["string", "null"] },
        allOf: [{ properties: { id: { type: "string", minLength: 1 } } }],
      },
    },
  },
};

describe("when the browser reads a resolved operation", () => {
  /** @scenario "Resolve OpenAPI references and request metadata" */
  it("keeps recursive schemas, drops undeclared keys and refuses malformed fields", () => {
    const parsed = operationSchema.parse({
      ...operation({ schema: { ...recursive, "x-internal": true } }),
      extra: 1,
    });
    expect(parsed.body?.contents[0]?.schema).toEqual(recursive);
    expect(parsed).not.toHaveProperty("extra");
    expect(parsed.responses).toEqual([{ status: "204", description: "No content", contents: [] }]);

    const nested = { properties: { spans: { items: { allOf: [{ minLength: "1" }] } } } };
    expect(z.validate(operationSchema, operation({ schema: nested }))).toBe(false);
    expect(z.validate(operationSchema, operation({ schema: null, origin: "app" }))).toBe(false);
  });
});
