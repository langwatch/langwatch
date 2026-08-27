/**
 * The query-domain door, in the document an integrator actually reads.
 *
 * `check:openapi-route-coverage` asks whether a registered route reached the
 * document; this asks whether the *checked-in* document still describes it. The
 * two fail for different reasons: the gate goes red when a `describeRoute` is
 * dropped, this goes red when the document is stale — a route annotated,
 * shipped, and never regenerated is published to nobody. The query domain is a
 * brand-new door onto LangWatchQL (issue #7565), so its first regeneration is
 * exactly the moment this class of staleness could slip through.
 *
 * A JSON-RPC surface raises the stakes for one of these checks in particular.
 * On a REST family the paths ARE the API, so a missing operation is obvious to
 * anyone reading the document. Here there is one path and the callable surface
 * is the method enum inside the request body — if that enum does not reach the
 * document, the published spec describes a door with no way to learn what may
 * be asked through it, and it still looks complete.
 *
 * @see specs/analytics/lwql-api.feature
 * @see https://github.com/langwatch/langwatch/issues/7565#issuecomment-5424087900
 */

import { describe, expect, it } from "vitest";

import specification from "../../openapiLangWatch.json";
import { QUERY_RPC_METHODS } from "../[[...route]]/schemas";

const QUERY = "/api/v1/query";

const paths = (specification as { paths: Record<string, any> }).paths;

/** The request body schema as published, with `$ref`s left as they are. */
function requestSchema(): any {
  return paths[QUERY]?.post?.requestBody?.content?.["application/json"]?.schema;
}

/**
 * Every string literal anywhere in a published schema.
 *
 * The generator is free to express the method enum as `enum`, as a union of
 * `const`s, or behind a `$ref` — all three are correct OpenAPI and which one
 * appears is not this family's contract. What IS the contract is that the
 * method names are *somewhere* a reader can find them, so the assertion walks
 * the whole document rather than pinning one encoding the generator never
 * promised to keep.
 */
function literalsIn(node: unknown, found = new Set<string>()): Set<string> {
  if (typeof node === "string") {
    found.add(node);
    return found;
  }
  if (Array.isArray(node)) {
    for (const item of node) literalsIn(item, found);
    return found;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node)) literalsIn(value, found);
  }
  return found;
}

describe("given the generated OpenAPI document", () => {
  describe("when the query-domain door is looked up", () => {
    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it("describes the endpoint with a summary, the Query tag and a success response", () => {
      const operation = paths[QUERY]?.post;

      expect(operation, `POST ${QUERY} is not in the document`).toBeDefined();
      expect(operation.summary, `POST ${QUERY}`).toBeTruthy();
      expect(operation.tags, `POST ${QUERY}`).toContain("Query");
      expect(operation.responses?.["200"], `POST ${QUERY}`).toBeDefined();
    });

    /**
     * A response schema is what a client generator compiles; a 2xx documented
     * with prose alone generates a call whose result is `unknown`.
     */
    /** @scenario "Client executes native ClickHouse SQL through the documented REST endpoint" */
    it("gives the success a response schema", () => {
      const schema =
        paths[QUERY]?.post?.responses?.["200"]?.content?.["application/json"]
          ?.schema;
      expect(
        schema,
        `POST ${QUERY} publishes no response schema`,
      ).toBeDefined();
    });

    /**
     * The level error this transport invites.
     *
     * On a REST family the response schema IS the payload. Here the payload is
     * nested under `result`, and publishing the bare payload instead would
     * generate a client that reads `columns` off the top level and finds
     * nothing — a mistake that typechecks, passes review, and only fails
     * against a live server. Asserted for every status that carries a body.
     */
    it.each([
      ["200", "result"],
      ["400", "error"],
      ["422", "error"],
    ])("publishes the JSON-RPC envelope, not the bare payload, on %s", (status, member) => {
      const schema =
        paths[QUERY]?.post?.responses?.[status]?.content?.["application/json"]
          ?.schema;
      const properties = schema?.properties ?? {};

      expect(
        Object.keys(properties),
        `${status} does not publish the envelope's own members`,
      ).toEqual(expect.arrayContaining(["jsonrpc", member]));
    });

    it("declares the JSON-RPC envelope as the request body", () => {
      expect(
        requestSchema(),
        `POST ${QUERY} takes an envelope and documents none`,
      ).toBeDefined();
    });

    /**
     * The one assertion a REST family would not need. With a single path, the
     * method names are the only description of what is callable.
     */
    it("publishes every callable method name in the request body", () => {
      const published = literalsIn(requestSchema());

      for (const method of QUERY_RPC_METHODS) {
        expect(
          published.has(method),
          `'${method}' is dispatched but never named in the published request body, ` +
            `so a client reading the document cannot learn to call it`,
        ).toBe(true);
      }
    });

    /**
     * The paths this door replaced must be gone, not merely superseded.
     *
     * The spec generator merges onto the previous document, so a path is only
     * removed when its prefix is listed for pruning. A stale entry left behind
     * publishes a second, dead way to call this domain — and it would look as
     * official as the live one.
     */
    it("no longer publishes the superseded query-domain paths", () => {
      for (const stale of ["/api/query/v1", "/api/query/v1/schema"]) {
        expect(
          paths[stale],
          `${stale} is still in the document after the move to ${QUERY}`,
        ).toBeUndefined();
      }
    });
  });
});
