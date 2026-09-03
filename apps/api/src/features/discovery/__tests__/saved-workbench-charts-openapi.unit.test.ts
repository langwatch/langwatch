/**
 * The chart operations, in the document an integrator actually reads.
 *
 * `check:openapi-route-coverage` asks whether a registered route reached the
 * document; this asks whether the *checked-in* document still describes it. The
 * two fail for different reasons: the gate goes red when a `describeRoute` is
 * dropped, this goes red when the document is stale — a route annotated,
 * shipped, and never regenerated is published to nobody.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see specs/analytics/lwql-langy-authoring.feature — the placement operations
 */

import { describe, expect, it } from "vitest";

import specification from "../openapi-document.json";

const COLLECTION = "/api/v1/projects/{projectId}/analytics/charts";
const RESOURCE = `${COLLECTION}/{chartId}`;
const PLACEMENT = `${RESOURCE}/placement`;

/** Every chart operation, and the status its success answer carries. */
const OPERATIONS = [
  { path: COLLECTION, method: "get", success: "200" },
  { path: COLLECTION, method: "post", success: "201" },
  { path: RESOURCE, method: "get", success: "200" },
  { path: RESOURCE, method: "patch", success: "200" },
  { path: RESOURCE, method: "delete", success: "204" },
  { path: PLACEMENT, method: "put", success: "200" },
  { path: PLACEMENT, method: "delete", success: "204" },
] as const;

const paths = (specification as { paths: Record<string, any> }).paths;

describe("given the generated OpenAPI document", () => {
  describe("when the saved workbench chart paths are looked up", () => {
    /** @scenario "Every chart endpoint is published in the API document" */
    it("describes every operation, each with a summary, a tag and a success response", () => {
      for (const { path, method, success } of OPERATIONS) {
        const where = `${method.toUpperCase()} ${path}`;
        const operation = paths[path]?.[method];

        expect(operation, `${where} is not in the document`).toBeDefined();
        expect(operation.summary, where).toBeTruthy();
        expect(operation.tags, where).toContain("Analytics / LangWatchQL");
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
          paths[path]?.[method]?.responses?.[success]?.content?.["application/json"]?.schema;
        expect(
          schema,
          `${method.toUpperCase()} ${path} publishes no response schema`,
        ).toBeDefined();
      }
    });

    /** @scenario "The placement endpoints are published in the API document" */
    it("publishes both placement operations, each described and answered with a schema or a 204", () => {
      const put = paths[PLACEMENT]?.put;
      const del = paths[PLACEMENT]?.delete;

      expect(put, `PUT ${PLACEMENT} is not in the document`).toBeDefined();
      expect(del, `DELETE ${PLACEMENT} is not in the document`).toBeDefined();
      for (const operation of [put, del]) {
        expect(operation.summary).toBeTruthy();
        expect(operation.tags).toContain("Analytics / LangWatchQL");
        // A missing dashboard and a missing chart share the one refusal.
        expect(operation.responses?.["404"]).toBeDefined();
      }
      expect(
        put.responses?.["200"]?.content?.["application/json"]?.schema,
        `PUT ${PLACEMENT} publishes no response schema`,
      ).toBeDefined();
      expect(del.responses?.["204"]).toBeDefined();
    });

    it("declares a request body for the three writes that take one", () => {
      for (const { path, method } of [
        { path: COLLECTION, method: "post" },
        { path: RESOURCE, method: "patch" },
        { path: PLACEMENT, method: "put" },
      ]) {
        expect(
          paths[path]?.[method]?.requestBody,
          `${method.toUpperCase()} ${path} takes a body and documents none`,
        ).toBeDefined();
      }
    });
  });
});
