// Query-domain doors in the checked-in OpenAPI document. Detects staleness.
// @see specs/analytics/lwql-api.feature

import { describe, expect, it } from "vitest";

import specification from "../openapi-document.json" with { type: "json" };

const RUN = "/api/v1/query";
const SCHEMA = "/api/v1/query/schema";

const paths = (specification as { paths: Record<string, any> }).paths;

/** The request body schema as published, with `$ref`s left as they are. */
function requestSchema(): any {
  return paths[RUN]?.post?.requestBody?.content?.["application/json"]?.schema;
}

function responseSchema({
  path,
  method,
  status,
}: {
  path: string;
  method: string;
  status: string;
}): any {
  return paths[path]?.[method]?.responses?.[status]?.content?.["application/json"]?.schema;
}

describe("given the generated OpenAPI document", () => {
  describe("when the query-domain doors are looked up", () => {
    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it.each([
      ["POST", RUN, "post"],
      ["GET", SCHEMA, "get"],
    ])(
      "describes %s %s with a summary, the Query tag and a success response",
      (label, path, method) => {
        const operation = paths[path]?.[method];

        expect(operation, `${label} ${path} is not in the document`).toBeDefined();
        expect(operation.summary, `${label} ${path}`).toBeTruthy();
        expect(operation.tags, `${label} ${path}`).toContain("Query");
        expect(operation.responses?.["200"], `${label} ${path}`).toBeDefined();
      },
    );

    /**
     * A response schema is what a client generator compiles; a 2xx documented
     * with prose alone generates a call whose result is `unknown`.
     */
    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it.each([
      ["POST", RUN, "post"],
      ["GET", SCHEMA, "get"],
    ])("gives %s %s's success a response schema", (label, path, method) => {
      expect(
        responseSchema({ path, method, status: "200" }),
        `${label} ${path} publishes no response schema`,
      ).toBeDefined();
    });

    // Payload at top level, not nested under envelope.
    it("publishes the run result itself as the 200 body", () => {
      const properties =
        responseSchema({ path: RUN, method: "post", status: "200" })?.properties ?? {};

      expect(Object.keys(properties)).toEqual(
        expect.arrayContaining(["columns", "rows", "statistics"]),
      );
      expect(properties).not.toHaveProperty("jsonrpc");
      expect(properties).not.toHaveProperty("result");
    });

    /** @scenario "client discovers LangWatchQL schema scoped to own permissions" */
    it("publishes the queryable schema itself as the 200 body", () => {
      const properties =
        responseSchema({ path: SCHEMA, method: "get", status: "200" })?.properties ?? {};

      expect(Object.keys(properties)).toEqual(expect.arrayContaining(["database", "datasets"]));
      expect(properties).not.toHaveProperty("jsonrpc");
    });

    it("declares the query itself as the request body", () => {
      const properties = requestSchema()?.properties ?? {};

      expect(requestSchema(), `POST ${RUN} takes a body and documents none`).toBeDefined();
      expect(Object.keys(properties)).toEqual(expect.arrayContaining(["sql"]));
      expect(properties).not.toHaveProperty("jsonrpc");
      expect(properties).not.toHaveProperty("method");
    });

    /** The schema door takes no input, so it must not declare a request body. */
    it("declares no request body on the schema door", () => {
      expect(paths[SCHEMA]?.get?.requestBody).toBeUndefined();
    });

    /**
     * The paths these doors replaced must be gone, not merely superseded.
     *
     * The spec generator merges onto the previous document, so a path is only
     * removed when its prefix is listed for pruning. A stale entry left behind
     * publishes a second, dead way to call this domain — and it would look as
     * official as the live one.
     */
    it("no longer publishes the superseded query-domain paths", () => {
      for (const stale of [
        "/api/v1/projects/{projectId}/analytics/query/clickhouse",
        "/api/v1/projects/{projectId}/analytics/schema",
      ]) {
        expect(
          paths[stale],
          `${stale} is still in the document after the move to ${RUN}`,
        ).toBeUndefined();
      }
    });
  });
});
