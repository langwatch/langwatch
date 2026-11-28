import { describe, expect, it } from "vitest";

import { bodyFormOf, type GroupField } from "../model/body-form.ts";
import { bodyFormEntries, readBodyForm } from "../model/body-value.ts";
import { operationSchema } from "../model/operation-schema.ts";

const operation = operationSchema.parse({
  method: "POST",
  path: "/api/things",
  origin: "https://app.langwatch.ai",
  summary: "Create a thing",
  description: "",
  deprecated: false,
  schemes: [],
  parameters: [],
  body: {
    required: true,
    description: "",
    contents: [
      {
        type: "application/json",
        schema: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            note: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            at: { type: "string", format: "date-time" },
            atMs: { type: "number", description: "Unix epoch in milliseconds." },
            window: {
              type: "object",
              required: ["label"],
              properties: {
                days: { type: "integer" },
                label: { type: "string" },
                meta: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
    ],
  },
  responses: [],
});

function form(): GroupField {
  const built = bodyFormOf({ operation });
  if (!built) throw new Error("no body form");
  return built;
}

describe("given a nested object in the body form", () => {
  /** @scenario "Switch to JSON with a required field empty inside a nested object" */
  it("counts its empty required field as unfilled, not as a broken value", () => {
    const read = readBodyForm({ form: form(), entries: { name: ["a"], "window--days": ["3"] } });

    expect(read.errors["body:window--label"]).toBe("label is required.");
    expect(read.unfilled).toContain("body:window--label");
  });

  /** @scenario "A broken JSON sub-field inside an empty optional object still blocks sending" */
  it("keeps the parse error of a JSON sub-field when nothing else in the object is filled", () => {
    const read = readBodyForm({
      form: form(),
      entries: { name: ["a"], "window--meta": ["{nope"] },
    });

    expect(read.errors["body:window--meta"]).toMatch(/Invalid JSON/);
    expect(read.unfilled).not.toContain("body:window--meta");
  });
});

describe("given JSON with a date the picker cannot hold", () => {
  /** @scenario "A date with milliseconds stays in JSON" */
  it("keeps an ISO timestamp or epoch with milliseconds in JSON, with the reason", () => {
    for (const value of [{ at: "2026-01-01T00:00:00.123Z" }, { atMs: 1_767_225_600_123 }]) {
      const read = bodyFormEntries({ form: form(), text: JSON.stringify({ name: "a", ...value }) });

      expect(read).toEqual({
        ok: false,
        reason: `The form cannot show ${Object.keys(value)[0]}. Edit it as JSON.`,
      });
    }
  });

  /** @scenario "A date with milliseconds stays in JSON" */
  it("takes a timestamp on the whole second into the form", () => {
    const read = bodyFormEntries({
      form: form(),
      text: JSON.stringify({ name: "a", at: "2026-01-01T00:00:00.000Z", atMs: 1_767_225_600_000 }),
    });

    expect(read).toMatchObject({
      ok: true,
      entries: { at: ["2026-01-01T00:00:00"], atMs: ["2026-01-01T00:00:00"] },
    });
  });
});

describe("given JSON with an empty value the form would drop", () => {
  /** @scenario "An empty value the form would drop stays in JSON" */
  it("keeps an empty string, optional list or optional object in JSON, with the reason", () => {
    for (const value of [{ note: "" }, { tags: [] }, { window: {} }]) {
      const read = bodyFormEntries({ form: form(), text: JSON.stringify({ name: "a", ...value }) });

      expect(read).toEqual({
        ok: false,
        reason: `The form cannot show ${Object.keys(value)[0]}. Edit it as JSON.`,
      });
    }
  });
});
