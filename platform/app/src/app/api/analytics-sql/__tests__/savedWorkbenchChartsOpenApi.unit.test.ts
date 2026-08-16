/**
 * The five chart operations, in the document an integrator actually reads.
 *
 * `check:openapi-route-coverage` asks whether a registered route reached the
 * document; this asks whether the *checked-in* document still describes it. The
 * two fail for different reasons: the gate goes red when a `describeRoute` is
 * dropped, this goes red when the document is stale — a route annotated,
 * shipped, and never regenerated is published to nobody.
 *
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";

import specification from "../../openapiLangWatch.json";

const COLLECTION = "/api/v1/projects/{projectId}/analytics/charts";
const RESOURCE = `${COLLECTION}/{chartId}`;

/** Every chart operation, and the status its success answer carries. */
const OPERATIONS = [
  { path: COLLECTION, method: "get", success: "200" },
  { path: COLLECTION, method: "post", success: "201" },
  { path: RESOURCE, method: "get", success: "200" },
  { path: RESOURCE, method: "patch", success: "200" },
  { path: RESOURCE, method: "delete", success: "204" },
] as const;

const paths = (specification as { paths: Record<string, any> }).paths;

describe("given the generated OpenAPI document", () => {
  describe("when the saved workbench chart paths are looked up", () => {
    /** @scenario "Every chart endpoint is published in the API document" */
    it("describes all five operations, each with a summary, a tag and a success response", () => {
      for (const { path, method, success } of OPERATIONS) {
        const where = `${method.toUpperCase()} ${path}`;
        const operation = paths[path]?.[method];

        expect(operation, `${where} is not in the document`).toBeDefined();
        expect(operation.summary, where).toBeTruthy();
        expect(operation.tags, where).toContain("Analytics / Governed SQL");
        expect(operation.responses?.[success], where).toBeDefined();
      }
    });

    /**
     * A response schema is what a client generator compiles; a 2xx documented
     * with prose alone generates a call whose result is `unknown`. 204 is
     * excluded because its answer is the absence of a body.
     */
    /** @scenario "Every chart endpoint is published in the API document" */
    it("gives every body-carrying success a response schema", () => {
      for (const { path, method, success } of OPERATIONS) {
        if (success === "204") continue;
        const schema =
          paths[path]?.[method]?.responses?.[success]?.content?.[
            "application/json"
          ]?.schema;
        expect(
          schema,
          `${method.toUpperCase()} ${path} publishes no response schema`,
        ).toBeDefined();
      }
    });

    it("declares a request body for the two writes that take one", () => {
      for (const { path, method } of [
        { path: COLLECTION, method: "post" },
        { path: RESOURCE, method: "patch" },
      ]) {
        expect(
          paths[path]?.[method]?.requestBody,
          `${method.toUpperCase()} ${path} takes a body and documents none`,
        ).toBeDefined();
      }
    });
  });
});
