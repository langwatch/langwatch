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

import specification from "../openapi-document.json";

type Schema = {
  $ref?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
};

const document = specification as unknown as {
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

/** Where every `required` list sits, and every property path, under a schema. */
type Walk = {
  requiredLists: { at: string; required: string[] }[];
  propertyPaths: string[];
};

function resolve(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.split("/").at(-1) ?? "";
  return document.components?.schemas?.[name] ?? {};
}

/** Every `required` list and every property reachable from a schema. */
function walk({
  schema,
  at,
  depth = 0,
}: {
  schema: Schema;
  at: string;
  depth?: number;
}): Walk {
  if (depth > 8) return { requiredLists: [], propertyPaths: [] };
  const node = resolve(schema);
  const requiredLists: Walk["requiredLists"] = [];
  const propertyPaths: string[] = [];

  if (node.required) requiredLists.push({ at, required: node.required });

  const children: { schema: Schema; at: string }[] = [];
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    propertyPaths.push(`${at}.${key}`);
    children.push({ schema: child, at: `${at}.${key}` });
  }
  if (node.items) children.push({ schema: node.items, at: `${at}[]` });
  for (const branch of [
    ...(node.anyOf ?? []),
    ...(node.oneOf ?? []),
    ...(node.allOf ?? []),
  ]) {
    children.push({ schema: branch, at });
  }

  for (const child of children) {
    const inner = walk({ ...child, depth: depth + 1 });
    requiredLists.push(...inner.requiredLists);
    propertyPaths.push(...inner.propertyPaths);
  }

  return { requiredLists, propertyPaths };
}

/**
 * The merged walk of every success answer of one path family.
 *
 * `bornWith` names the routes of the family that were published with the
 * field from their first day, so no client generated before it exists. Their
 * answers may read it as required.
 */
function walkFamily({
  family,
  bornWith = [],
}: {
  family: string;
  bornWith?: string[];
}): Walk {
  const requiredLists: Walk["requiredLists"] = [];
  const propertyPaths: string[] = [];
  for (const [path, operations] of Object.entries(document.paths)) {
    if (!path.startsWith(family)) continue;
    if (bornWith.some((route) => path.startsWith(route))) continue;
    for (const [method, operation] of Object.entries(operations)) {
      if (!METHODS.includes(method)) continue;
      for (const [status, response] of Object.entries(
        operation.responses ?? {},
      )) {
        if (!status.startsWith("2")) continue;
        for (const media of Object.values(response.content ?? {})) {
          if (!media.schema) continue;
          const answer = walk({
            schema: media.schema,
            at: `${method.toUpperCase()} ${path} ${status}`,
          });
          requiredLists.push(...answer.requiredLists);
          propertyPaths.push(...answer.propertyPaths);
        }
      }
    }
  }
  return { requiredLists, propertyPaths };
}

/**
 * Where the field is present in the family, and where it is read as required.
 *
 * An empty `offenders` alone also holds for a field the document no longer
 * carries, so `occurrences` states the field is still there to be read.
 */
function readingOf({
  family,
  field,
  bornWith,
}: {
  family: string;
  field: string;
  bornWith?: string[];
}) {
  const { requiredLists, propertyPaths } = walkFamily({ family, bornWith });
  return {
    occurrences: propertyPaths.filter((path) => path.endsWith(`.${field}`)),
    offenders: requiredLists
      .filter((entry) => entry.required.includes(field))
      .map((entry) => entry.at),
  };
}

describe("given the generated OpenAPI document", () => {
  describe("when the scenario answers are read", () => {
    /** @scenario "The scenario answers read testSuiteId as optional" */
    it("lists testSuiteId as optional on every success answer", () => {
      const testSuiteId = readingOf({
        family: "/api/scenarios",
        field: "testSuiteId",
      });
      expect(testSuiteId.occurrences.length).toBeGreaterThan(0);
      expect(testSuiteId.offenders).toEqual([]);
    });
  });

  describe("when the scenario model and turn fields are read", () => {
    /** @scenario "The scenario answers read the model and turn fields as optional" */
    it("lists simulatorModel, judgeModel, maxTurns and minTurns as optional on every success answer", () => {
      for (const field of [
        "simulatorModel",
        "judgeModel",
        "maxTurns",
        "minTurns",
      ]) {
        // The version snapshot was published with these fields from its
        // first day, so it may read them as required.
        const reading = readingOf({
          family: "/api/scenarios",
          field,
          bornWith: ["/api/scenarios/{id}/versions"],
        });
        expect(reading.occurrences.length, field).toBeGreaterThan(0);
        expect(reading.offenders, field).toEqual([]);
      }
    });
  });

  describe("when the suite answers are read", () => {
    /** @scenario "The suite answers read kind and scope as optional" */
    it("lists kind and scope as optional on every success answer", () => {
      const kind = readingOf({ family: "/api/suites", field: "kind" });
      const scope = readingOf({ family: "/api/suites", field: "scope" });
      expect(kind.occurrences.length).toBeGreaterThan(0);
      expect(scope.occurrences.length).toBeGreaterThan(0);
      expect(kind.offenders).toEqual([]);
      expect(scope.offenders).toEqual([]);
    });
  });

  describe("when the simulation run answers are read", () => {
    /** @scenario "The simulation run answers read note and scenarioVersion as optional" */
    it("lists note and scenarioVersion as optional on every success answer", () => {
      const note = readingOf({
        family: "/api/simulation-runs",
        field: "note",
      });
      const version = readingOf({
        family: "/api/simulation-runs",
        field: "scenarioVersion",
      });
      expect(note.occurrences.length).toBeGreaterThan(0);
      expect(version.occurrences.length).toBeGreaterThan(0);
      expect(note.offenders).toEqual([]);
      expect(version.offenders).toEqual([]);
    });
  });
});
