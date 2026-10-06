/**
 * What the generated OpenAPI document publishes about its schemas: no boolean exclusive bounds,
 * and the fields a family gained later read as optional.
 * @vitest-environment node
 * @see specs/api-reference/exclusive-bounds-3-1.feature
 * @see specs/api-reference/legacy-response-fields-optional.feature
 */
import { beforeAll, describe, expect, it } from "vitest";

import { generateOpenApiDocument } from "../openapi-document.ts";

type Json = Record<string, unknown>;

let document: Json;

beforeAll(async () => {
  document = await generateOpenApiDocument();
}, 240_000);

/** The one of `$ref`s a schema reaches, followed to the component it names. */
function component(ref: string): unknown {
  const name = ref.replace("#/components/schemas/", "");
  return ((document.components as Json | undefined)?.schemas as Json | undefined)?.[name];
}

/** Every node of a JSON value, `$ref`s followed once each. */
function* walk(node: unknown, seen: Set<string> = new Set()): Generator<Json> {
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child, seen);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Json;
  yield record;
  const ref = record.$ref;
  if (typeof ref === "string" && !seen.has(ref)) {
    seen.add(ref);
    yield* walk(component(ref), seen);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== "$ref") yield* walk(child, seen);
  }
}

/** The schemas of one family's 2xx answers: every path the family publishes, bare or `/api/v1`. */
function successSchemas(family: string): unknown[] {
  const schemas: unknown[] = [];
  for (const [path, item] of Object.entries(document.paths as Json)) {
    const bare = path.replace(/^\/api\/v1\//, "/api/");
    if (bare !== family && !bare.startsWith(`${family}/`)) continue;
    for (const operation of Object.values(item as Json)) {
      for (const [status, response] of Object.entries(
        ((operation as Json).responses ?? {}) as Json,
      )) {
        if (!/^2\d\d$/.test(status)) continue;
        const content = ((response as Json).content ?? {}) as Json;
        for (const media of Object.values(content)) schemas.push((media as Json).schema);
      }
    }
  }
  return schemas;
}

/** Whether any success answer of the family declares the property at all. */
function publishes({ family, property }: { family: string; property: string }): boolean {
  for (const schema of successSchemas(family)) {
    for (const node of walk(schema)) {
      const properties = node.properties as Json | undefined;
      if (properties !== undefined && property in properties) return true;
    }
  }
  return false;
}

/** The names the family's success answers list as required, anywhere in their shape. */
function requiredNames(family: string): Set<string> {
  const names = new Set<string>();
  for (const schema of successSchemas(family)) {
    for (const node of walk(schema)) {
      if (Array.isArray(node.required)) for (const name of node.required) names.add(String(name));
    }
  }
  return names;
}

describe("the generated OpenAPI document", () => {
  /** @scenario "The published document carries no boolean exclusive bound" */
  it("spells no exclusive bound as a boolean in any schema", () => {
    const offenders: string[] = [];
    for (const node of walk(document)) {
      for (const key of ["exclusiveMinimum", "exclusiveMaximum"]) {
        if (typeof node[key] === "boolean") offenders.push(key);
      }
    }

    expect(offenders).toEqual([]);
  });

  describe("given the scenario answers", () => {
    it("publishes answers for the family at all", () => {
      expect(successSchemas("/api/scenarios")).not.toEqual([]);
    });

    /** @scenario "The scenario answers read testSuiteId as optional" */
    it("lists testSuiteId as required in none of them", () => {
      expect(publishes({ family: "/api/scenarios", property: "testSuiteId" })).toBe(true);
      expect(requiredNames("/api/scenarios").has("testSuiteId")).toBe(false);
    });
  });

  describe("given the suite answers", () => {
    it("publishes answers for the family at all", () => {
      expect(successSchemas("/api/suites")).not.toEqual([]);
    });

    /** @scenario "The suite answers read kind and scope as optional" */
    it("lists kind and scope as required in none of them", () => {
      const required = requiredNames("/api/suites");

      for (const field of ["kind", "scope"]) {
        expect(publishes({ family: "/api/suites", property: field }), field).toBe(true);
        expect(required.has(field), field).toBe(false);
      }
    });
  });

  describe("given the simulation run answers", () => {
    it("publishes answers for the family at all", () => {
      expect(successSchemas("/api/simulation-runs")).not.toEqual([]);
    });

    /** @scenario "The simulation run answers read note and scenarioVersion as optional" */
    it("lists note and scenarioVersion as required in none of them", () => {
      const required = requiredNames("/api/simulation-runs");

      for (const field of ["note", "scenarioVersion"]) {
        expect(publishes({ family: "/api/simulation-runs", property: field }), field).toBe(true);
        expect(required.has(field), field).toBe(false);
      }
    });
  });
});
