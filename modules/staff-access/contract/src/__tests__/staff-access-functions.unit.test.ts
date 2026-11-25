/** @see modules/staff-access/specs/staff-access-functions.feature */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { STAFF_ACCESS_FUNCTION_NAMES, STAFF_ACCESS_FUNCTIONS } from "../staff-access-functions.ts";

/** Field names that read as what someone wrote, a way to reach them, or a credential. */
const CONTENT_OR_SECRET =
  /content|message|prompt|text|body|payload|transcript|input|output|answer|question|comment|description|note|secret|token|password|hash|salt|credential|signature|cookie|email|phone|address|url|ipaddress/i;
/** Fields an org function input could use to reach past the approved organization. */
const ORGANIZATION_REACH = /^(organization|org|tenant|team|user|email)/i;

type JsonNode = Readonly<{
  type?: string | string[];
  properties?: Record<string, JsonNode>;
  items?: JsonNode;
  additionalProperties?: JsonNode | boolean;
  anyOf?: JsonNode[];
}>;

function jsonOf(schema: z.ZodType): JsonNode {
  return z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as JsonNode;
}

/** Every property name in the schema, with its path. */
function fieldsOf(node: JsonNode, path: string[] = []): { name: string; path: string[] }[] {
  const own = Object.entries(node.properties ?? {}).flatMap(([name, child]) => [
    { name, path: [...path, name] },
    ...fieldsOf(child, [...path, name]),
  ]);
  const nested = [
    ...(node.items ? [node.items] : []),
    ...(typeof node.additionalProperties === "object" ? [node.additionalProperties] : []),
    ...(node.anyOf ?? []),
  ].flatMap((child) => fieldsOf(child, path));
  return [...own, ...nested];
}

const isObject = (node: JsonNode | undefined) =>
  node?.type === "object" || (Array.isArray(node?.type) && node.type.includes("object"));

/** Paths of arrays of objects that are not the `items` of a page. */
function unpagedLists(node: JsonNode, path: string[] = []): string[] {
  const here = Object.entries(node.properties ?? {}).flatMap(([name, child]) => {
    const isPageItems =
      name === "items" &&
      node.properties?.total !== undefined &&
      node.properties?.truncated !== undefined &&
      node.properties?.nextCursor !== undefined;
    const bad = child.type === "array" && isObject(child.items) && !isPageItems;
    const below = child.items ? unpagedLists(child.items, [...path, name]) : [];
    return [
      ...(bad ? [[...path, name].join(".")] : []),
      ...below,
      ...unpagedLists(child, [...path, name]),
    ];
  });
  return here;
}

const entries = STAFF_ACCESS_FUNCTION_NAMES.map(
  (name) => [name, STAFF_ACCESS_FUNCTIONS[name]] as const,
);

describe("the ops function registry", () => {
  /** @scenario "No function output names content or a secret" */
  it.each(entries)("%s answers no content or secret field", (name, fn) => {
    const fields = fieldsOf(jsonOf(fn.output));
    const offending = fields.filter(
      (field) =>
        CONTENT_OR_SECRET.test(field.name) || (fn.scope !== "lookup" && field.name === "name"),
    );

    expect(offending.map((field) => `${name}: ${field.path.join(".")}`)).toEqual([]);
  });

  it("refuses a field the word list names", () => {
    const leaky = z.object({
      items: z.array(z.object({ id: z.string(), promptText: z.string() })),
    });

    expect(fieldsOf(jsonOf(leaky)).some((field) => CONTENT_OR_SECRET.test(field.name))).toBe(true);
  });

  it.each(entries)("%s refuses an input field it does not declare", (_name, fn) => {
    expect(fn.input.validate({ undeclared: true })).toBe(false);
  });

  /** @scenario "No org function input names an organization" */
  it.each(entries.filter(([, fn]) => fn.scope === "org"))(
    "%s takes no input that reaches another organization",
    (_name, fn) => {
      const names = Object.keys(fn.input.shape);

      expect(names.filter((name) => ORGANIZATION_REACH.test(name))).toEqual([]);
    },
  );

  /** @scenario "Every list a function answers is a page" */
  it.each(entries)("%s answers every list of records as a page", (_name, fn) => {
    expect(unpagedLists(jsonOf(fn.output))).toEqual([]);
  });

  it("finds a list that is not a page", () => {
    const bare = z.object({ rows: z.array(z.object({ id: z.string() })) });

    expect(unpagedLists(jsonOf(bare))).toEqual(["rows"]);
  });

  it("marks only lookups as personal", () => {
    const personal = entries.filter(([, fn]) => "personal" in fn && fn.personal);

    expect(personal.length).toBeGreaterThan(0);
    expect(personal.every(([, fn]) => fn.scope === "lookup")).toBe(true);
  });
});
