/**
 * The query-domain doors, in the document an integrator actually reads.
 *
 * `check:openapi-route-coverage` asks whether a registered route reached the
 * document; this asks whether the *checked-in* document still describes it. The
 * two fail for different reasons: the gate goes red when a `describeRoute` is
 * dropped, this goes red when the document is stale — a route annotated,
 * shipped, and never regenerated is published to nobody. The query domain is a
 * brand-new door onto LangWatchQL (issue #7565), so its first regeneration is
 * exactly the moment this class of staleness could slip through.
 *
 * @see specs/lwql/api.feature
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { describe, expect, it } from "vitest";

import specification from "../../openapiLangWatch.json";

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
  return paths[path]?.[method]?.responses?.[status]?.content?.[
    "application/json"
  ]?.schema;
}

describe("given the generated OpenAPI document", () => {
  describe("when the query-domain doors are looked up", () => {
    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it.each([
      ["POST", RUN, "post"],
      ["GET", SCHEMA, "get"],
    ])("describes %s %s with a summary, the Query tag and a success response", (label, path, method) => {
      const operation = paths[path]?.[method];

      expect(
        operation,
        `${label} ${path} is not in the document`,
      ).toBeDefined();
      expect(operation.summary, `${label} ${path}`).toBeTruthy();
      expect(operation.tags, `${label} ${path}`).toContain("Query");
      expect(operation.responses?.["200"], `${label} ${path}`).toBeDefined();
    });

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

    /**
     * The payload, at the top level — not nested under an envelope member.
     *
     * This family briefly answered JSON-RPC, where the result sat under
     * `result` and an error under `error.code` as a number. Publishing either
     * of those now would generate a client that reads `columns` off the wrong
     * level and finds nothing — a mistake that typechecks, passes review, and
     * only fails against a live server.
     */
    it("publishes the run result itself as the 200 body", () => {
      const properties =
        responseSchema({ path: RUN, method: "post", status: "200" })
          ?.properties ?? {};

      expect(Object.keys(properties)).toEqual(
        expect.arrayContaining(["columns", "rows", "statistics"]),
      );
      expect(properties).not.toHaveProperty("jsonrpc");
      expect(properties).not.toHaveProperty("result");
    });

    /** @scenario "Authenticated client discovers its LangWatchQL schema scoped to its own permissions" */
    it("publishes the queryable schema itself as the 200 body", () => {
      const properties =
        responseSchema({ path: SCHEMA, method: "get", status: "200" })
          ?.properties ?? {};

      expect(Object.keys(properties)).toEqual(
        expect.arrayContaining(["database", "views"]),
      );
      expect(properties).not.toHaveProperty("jsonrpc");
    });

    it("declares the query itself as the request body", () => {
      const properties = requestSchema()?.properties ?? {};

      expect(
        requestSchema(),
        `POST ${RUN} takes a body and documents none`,
      ).toBeDefined();
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

    describe("when the schema door's response is inspected", () => {
      /** @scenario "The published OpenAPI schema for the schema endpoint declares the functions field" */
      it("declares a functions field typed as an array of strings", () => {
        const functionsField = responseSchema({
          path: SCHEMA,
          method: "get",
          status: "200",
        })?.properties?.functions;

        expect(
          functionsField,
          "GET /api/v1/query/schema publishes no functions field",
        ).toBeDefined();
        expect(functionsField.type).toBe("array");
        expect(functionsField.items?.type).toBe("string");
      });
    });

    describe("when both doors' descriptions are checked for the any-key scope rule", () => {
      /** @scenario "The OpenAPI descriptions for both query routes name the any-key scope rule" */
      it.each([
        ["POST", RUN, "post"],
        ["GET", SCHEMA, "get"],
      ])("names analytics:view and the organization-key rule in %s %s's description", (label, path, method) => {
        const description: string = paths[path]?.[method]?.description ?? "";

        expect(description, `${label} ${path}`).toContain("analytics:view");
        expect(description, `${label} ${path}`).toMatch(/organization/i);
      });

      /** @scenario "The OpenAPI descriptions for both query routes name the any-key scope rule" */
      it.each([
        ["POST", RUN, "post"],
        ["GET", SCHEMA, "get"],
      ])("no longer names X-Project-Id or project_scope_required in %s %s's description", (label, path, method) => {
        const description: string = paths[path]?.[method]?.description ?? "";

        expect(description, `${label} ${path}`).not.toContain("X-Project-Id");
        expect(description, `${label} ${path}`).not.toContain(
          "project_scope_required",
        );
      });
    });

    describe("when the run door's description is checked for the response ceilings", () => {
      /** @scenario "A statement with no LIMIT is capped at the row ceiling" */
      /** @scenario "A LIMIT above the ceiling is refused before the query runs" */
      it("states the appended row cap, the LIMIT_TOO_HIGH refusal and the byte hard error", () => {
        const description: string = paths[RUN]?.post?.description ?? "";

        expect(description).toMatch(/10,?000\s*rows?/i);
        expect(description).toMatch(/8,?000,?000\s*bytes?/i);
        expect(description).toContain("LIMIT_TOO_HIGH");
        expect(description).toContain("lwql_result_too_large");
        expect(description).toContain("OFFSET");
      });

      /** @scenario "Each UNION branch must carry its own LIMIT ceiling" */
      it("documents LIMIT_REQUIRED_PER_BRANCH for UNION queries", () => {
        const description: string = paths[RUN]?.post?.description ?? "";

        expect(description).toContain("LIMIT_REQUIRED_PER_BRANCH");
        expect(description).toContain("UNION");
      });

      /** @scenario "Overflow throws and never silently truncates" */
      it("no longer advertises a truncated flag or a RESULT_TRUNCATED diagnostic", () => {
        const description: string = paths[RUN]?.post?.description ?? "";
        const resultSchema = responseSchema({
          path: RUN,
          method: "post",
          status: "200",
        });

        expect(description).not.toContain("RESULT_TRUNCATED");
        expect(resultSchema?.properties?.truncated).toBeUndefined();
      });
    });
  });
});
