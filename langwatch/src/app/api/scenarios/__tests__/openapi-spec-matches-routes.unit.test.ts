/**
 * @vitest-environment node
 *
 * `openapiLangWatch.json` is a checked-in generated artifact, and the SDK and
 * CLI types are generated from it — so when it drifts from the routes, a
 * TypeScript consumer can send a field the API accepts but cannot discover it,
 * or worse, is told a field exists that no longer does.
 *
 * Nothing in CI regenerates it, and the full `generateOpenAPISpec` task is
 * currently broken for an unrelated reason (the prompts app's circular
 * schema), so drift is silent. This is the cheap guard: the spec's scenario
 * request bodies must carry every field the write contract defines.
 *
 * It is not a substitute for regenerating — it is the alarm that says you
 * need to. Run `pnpm run task generateScenariosOpenAPISpec` when it fires.
 */
import { describe, expect, it } from "vitest";
import spec from "../../openapiLangWatch.json";
import { redTeamFields } from "~/server/scenarios/red-team-input";

type SchemaLike = { properties?: Record<string, unknown> };

const paths = (spec as { paths: Record<string, Record<string, unknown>> })
  .paths;

function requestProperties(path: string, method: string): string[] {
  const operation = paths[path]?.[method] as
    | {
        requestBody?: {
          content?: Record<string, { schema?: SchemaLike }>;
        };
      }
    | undefined;
  const schema =
    operation?.requestBody?.content?.["application/json"]?.schema ?? {};
  return Object.keys(schema.properties ?? {});
}

describe("the checked-in OpenAPI spec", () => {
  const expected = Object.keys(redTeamFields);

  describe("given the scenario write routes", () => {
    it("describes every red-team field on create", () => {
      const properties = requestProperties("/api/scenarios", "post");

      // Sanity: if this is empty the lookup is wrong, not the spec.
      expect(properties.length).toBeGreaterThan(0);
      for (const field of expected) {
        expect(properties).toContain(field);
      }
    });

    it("describes every red-team field on update", () => {
      const properties = requestProperties("/api/scenarios/{id}", "put");

      expect(properties.length).toBeGreaterThan(0);
      for (const field of expected) {
        expect(properties).toContain(field);
      }
    });
  });
});
