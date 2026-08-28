/**
 * The fields the scenario, suite and simulation-run families gained after
 * clients were generated from them, in the document those clients are
 * generated from.
 *
 * A generated client reads a required field with no fallback, so a field
 * marked required in the document breaks that client against every server
 * that predates the field. The families keep sending the fields; the document
 * reads them as optional.
 *
 * @see specs/api-reference/legacy-response-fields-optional.feature
 */

import { describe, expect, it } from "vitest";

import specification from "../openapiLangWatch.json";

type Schema = {
  $ref?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
};

const document = specification as {
  paths: Record<
    string,
    Record<
      string,
      {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: Schema }> }
        >;
      }
    >
  >;
  components?: { schemas?: Record<string, Schema> };
};

const METHODS = ["get", "post", "put", "patch", "delete"];

function resolve(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.split("/").at(-1) ?? "";
  return document.components?.schemas?.[name] ?? {};
}

/** Every `required` list reachable from a schema, each with where it sits. */
function requiredLists(
  schema: Schema,
  at: string,
  depth = 0,
): { at: string; required: string[] }[] {
  if (depth > 8) return [];
  const node = resolve(schema);
  const found: { at: string; required: string[] }[] = [];
  if (node.required) found.push({ at, required: node.required });
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    found.push(...requiredLists(child, `${at}.${key}`, depth + 1));
  }
  if (node.items)
    found.push(...requiredLists(node.items, `${at}[]`, depth + 1));
  for (const branch of [
    ...(node.anyOf ?? []),
    ...(node.oneOf ?? []),
    ...(node.allOf ?? []),
  ]) {
    found.push(...requiredLists(branch, at, depth + 1));
  }
  return found;
}

/** The `required` lists of every success answer of one path family. */
function successRequiredLists(family: string) {
  const lists: { at: string; required: string[] }[] = [];
  for (const [path, operations] of Object.entries(document.paths)) {
    if (!path.startsWith(family)) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (!METHODS.includes(method)) continue;
      for (const [status, response] of Object.entries(
        operation.responses ?? {},
      )) {
        if (!status.startsWith("2")) continue;
        for (const media of Object.values(response.content ?? {})) {
          if (!media.schema) continue;
          lists.push(
            ...requiredLists(
              media.schema,
              `${method.toUpperCase()} ${path} ${status}`,
            ),
          );
        }
      }
    }
  }
  return lists;
}

/** How many success answers the family has, and where the field is required. */
function requiredIn({ family, field }: { family: string; field: string }) {
  const lists = successRequiredLists(family);
  return {
    answers: lists.length,
    offenders: lists
      .filter((entry) => entry.required.includes(field))
      .map((entry) => entry.at),
  };
}

describe("given the generated OpenAPI document", () => {
  describe("when the scenario answers are read", () => {
    /** @scenario "The scenario answers read folderId as optional" */
    it("lists folderId as optional on every success answer", () => {
      const folderId = requiredIn({
        family: "/api/scenarios",
        field: "folderId",
      });
      expect(folderId.answers).toBeGreaterThan(0);
      expect(folderId.offenders).toEqual([]);
    });
  });

  describe("when the suite answers are read", () => {
    /** @scenario "The suite answers read kind and scope as optional" */
    it("lists kind and scope as optional on every success answer", () => {
      const kind = requiredIn({ family: "/api/suites", field: "kind" });
      const scope = requiredIn({ family: "/api/suites", field: "scope" });
      expect(kind.answers).toBeGreaterThan(0);
      expect(kind.offenders).toEqual([]);
      expect(scope.offenders).toEqual([]);
    });
  });

  describe("when the simulation run answers are read", () => {
    /** @scenario "The simulation run answers read note and scenarioVersion as optional" */
    it("lists note and scenarioVersion as optional on every success answer", () => {
      const note = requiredIn({
        family: "/api/simulation-runs",
        field: "note",
      });
      const version = requiredIn({
        family: "/api/simulation-runs",
        field: "scenarioVersion",
      });
      expect(note.answers).toBeGreaterThan(0);
      expect(note.offenders).toEqual([]);
      expect(version.offenders).toEqual([]);
    });
  });
});
