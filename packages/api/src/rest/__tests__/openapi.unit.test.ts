/**
 * What one declared route publishes: the body a caller sends a route that
 * reads its own bytes, and the 3.1 spelling of an exclusive bound.
 *
 * @see specs/api-reference/exclusive-bounds-3-1.feature
 * @see ../../../specs/endpoint-capabilities.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { RestTransportRoute } from "../declaration.ts";
import type { RestTransportDocs } from "../openapi.ts";
import {
  hoistStraySchemaDefs,
  normalizeExclusiveBounds,
  restRouteDocumentation,
} from "../openapi.ts";

/** A webhook intake: the signature is over the exact characters, so nothing parses them. */
function rawBodyRoute(docs?: RestTransportDocs): RestTransportRoute<unknown> {
  return {
    method: "post",
    path: "/intake",
    operation: "intake",
    version: "2026-09-09",
    output: z.void(),
    rawBody: { form: "text", mediaType: "application/json" },
    ...(docs ? { docs } : {}),
    handler: () => undefined,
  };
}

/** An ordinary declared route: output schema stated once, via `withOutput`'s slot. */
function declaredOutputRoute(docs?: RestTransportDocs): RestTransportRoute<unknown> {
  return {
    method: "get",
    path: "/widgets",
    operation: "listWidgets",
    version: "2026-09-09",
    output: z.object({ id: z.string() }),
    ...(docs ? { docs } : {}),
    handler: () => undefined,
  };
}

describe("restRouteDocumentation", () => {
  describe("given a route that declared its output schema", () => {
    describe("when its docs name the success status with a description alone", () => {
      /** @scenario "A documented answer with only a description keeps the declared shape" */
      it("publishes the docs' words over the declaration's content", () => {
        const published = restRouteDocumentation({
          route: declaredOutputRoute({
            responses: { 200: { description: "The project's widgets" } },
          }),
        });

        const derived = restRouteDocumentation({ route: declaredOutputRoute() });

        const success = (
          published.responses as Record<string, { description: string; content: unknown }>
        )["200"];

        const declaredSuccess = (derived.responses as Record<string, { content: unknown }>)["200"];
        expect(success?.description).toBe("The project's widgets");

        // The published document is JSON; the resolver's function members are
        // not part of what a reader receives, so the JSON forms are compared.
        expect(JSON.parse(JSON.stringify(success?.content))).toEqual(
          JSON.parse(JSON.stringify(declaredSuccess?.content)),
        );

        expect(success?.content).toMatchObject({ "application/json": expect.anything() });
      });
    });

    describe("when its docs restate the success status with their own content", () => {
      /** @scenario "A documented answer that states content overrides the declared shape" */
      it("publishes the docs' content", () => {
        const statedContent = { "text/plain": {} };

        const published = restRouteDocumentation({
          route: declaredOutputRoute({
            responses: { 200: { description: "Bytes", content: statedContent } },
          }),
        });

        const success = (published.responses as Record<string, { content: unknown }>)["200"];
        expect(success?.content).toEqual(statedContent);
      });
    });

    describe("when its docs name an error by status and a sentence alone", () => {
      it("publishes the sentence with no content at all, never a hand-written schema", () => {
        const published = restRouteDocumentation({
          route: declaredOutputRoute({
            errors: [{ status: 404, description: "No widget with that id" }],
          }),
        });

        const notFound = (
          published.responses as Record<string, { description: string; content: unknown }>
        )["404"];
        expect(notFound?.description).toBe("No widget with that id");
        expect(notFound?.content).toEqual({});
      });
    });
  });

  describe("given a route that reads its own body and wrote out the request it expects", () => {
    /** @scenario "A route that reads its own body publishes the shape a caller sends it" */
    it("publishes that shape, and its description, under the media type it reads", () => {
      const published = restRouteDocumentation({
        route: rawBodyRoute({
          requestBody: {
            description: "The event exactly as the sender wrote it.",
            schema: z.object({ event: z.string(), sentAt: z.number().optional() }),
          },
        }),
      });

      expect(published.requestBody).toEqual({
        required: true,
        description: "The event exactly as the sender wrote it.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { event: { type: "string" }, sentAt: { type: "number" } },
              required: ["event"],
            },
          },
        },
      });
    });
  });

  describe("given a route that reads its own body and wrote no request out", () => {
    it("publishes the media type it reads with no shape at all", () => {
      const published = restRouteDocumentation({ route: rawBodyRoute() });

      expect(published.requestBody).toEqual({
        required: true,
        content: { "application/json": {} },
      });
    });
  });
});

describe("normalizeExclusiveBounds", () => {
  describe("given a lower bound written the 3.0 way", () => {
    /** @scenario "A boolean exclusive bound is rewritten as the number it meant" */
    it("rewrites the flag as the number it meant and drops the inclusive bound", () => {
      const schema = {
        type: "integer",
        minimum: 0,
        exclusiveMinimum: true,
        maximum: 1000,
      };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({
        type: "integer",
        exclusiveMinimum: 0,
        maximum: 1000,
      });
    });
  });

  describe("given an upper bound written the 3.0 way", () => {
    /** @scenario "The same holds for an upper bound" */
    it("rewrites the flag as the number it meant", () => {
      const schema = { type: "number", maximum: 100, exclusiveMaximum: true };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({ type: "number", exclusiveMaximum: 100 });
    });
  });

  describe("given an inclusive bound", () => {
    /** @scenario "An inclusive bound is left as it was" */
    it("keeps the bound and drops the flag that said nothing", () => {
      const schema = { type: "integer", minimum: 0, exclusiveMinimum: false };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({ type: "integer", minimum: 0 });
    });
  });

  describe("given a flag with no bound beside it", () => {
    /** @scenario "A flag with no bound beside it is dropped" */
    it("drops the flag", () => {
      const schema = { type: "integer", exclusiveMinimum: true };

      normalizeExclusiveBounds(schema);

      expect(schema).toEqual({ type: "integer" });
    });
  });

  describe("given a document with the bounds nested in arrays and objects", () => {
    it("walks the whole document", () => {
      const document = {
        components: {
          schemas: {
            page: {
              anyOf: [{ type: "integer", minimum: 0, exclusiveMinimum: true }],
            },
          },
        },
      };

      normalizeExclusiveBounds(document);

      expect(document.components.schemas.page.anyOf[0]).toEqual({
        type: "integer",
        exclusiveMinimum: 0,
      });
    });
  });
});

describe("hoistStraySchemaDefs", () => {
  function documentWith(schema: unknown) {
    return {
      components: { schemas: {} as Record<string, unknown> },
      paths: {
        "/a": { get: { responses: { 200: { content: { "application/json": { schema } } } } } },
      },
    };
  }

  describe("given a response schema carrying a local $defs entry", () => {
    /** @scenario "A schema with a local $defs block is hoisted into components" */
    it("moves the entry into components and repoints the ref at its new place", () => {
      const document = documentWith({
        $ref: "#/components/schemas/__schema0",
        $defs: { __schema0: { type: "string" } },
      });

      hoistStraySchemaDefs(document);

      expect(document.components.schemas).toEqual({ __hoisted0: { type: "string" } });

      const schema = document.paths["/a"].get.responses[200].content["application/json"].schema;

      expect(schema).toEqual({ $ref: "#/components/schemas/__hoisted0" });
    });
  });

  describe("given two schemas that each name a $defs entry the same generic name", () => {
    /** @scenario "Two unrelated schemas each name a $defs entry the same generic name" */
    it("hoists each under its own name, neither overwriting the other", () => {
      const document = {
        components: { schemas: {} as Record<string, unknown> },
        paths: {
          "/a": {
            get: {
              schema: {
                $ref: "#/components/schemas/__schema0",
                $defs: { __schema0: { type: "string" } },
              },
            },
          },
          "/b": {
            get: {
              schema: {
                $ref: "#/components/schemas/__schema0",
                $defs: { __schema0: { type: "number" } },
              },
            },
          },
        },
      };

      hoistStraySchemaDefs(document);

      expect(Object.values(document.components.schemas)).toEqual(
        expect.arrayContaining([{ type: "string" }, { type: "number" }]),
      );
      expect(Object.keys(document.components.schemas)).toHaveLength(2);
      expect(document.paths["/a"].get.schema.$ref).not.toBe(document.paths["/b"].get.schema.$ref);
    });
  });

  describe("given a $defs entry that references itself", () => {
    /** @scenario "A $defs entry that references itself keeps resolving after the move" */
    it("repoints the definition's own self-reference at its new name", () => {
      const document = documentWith({
        $ref: "#/components/schemas/__schema0",
        $defs: {
          __schema0: {
            type: "object",
            additionalProperties: { $ref: "#/components/schemas/__schema0" },
          },
        },
      });

      hoistStraySchemaDefs(document);

      expect(document.components.schemas.__hoisted0).toEqual({
        type: "object",
        additionalProperties: { $ref: "#/components/schemas/__hoisted0" },
      });
    });
  });

  describe("given a response schema with no $defs entry", () => {
    /** @scenario "A schema with no $defs is left exactly as it was" */
    it("leaves the schema exactly as it was", () => {
      const document = documentWith({ type: "object", properties: { id: { type: "string" } } });

      hoistStraySchemaDefs(document);

      expect(document.components.schemas).toEqual({});
      expect(document.paths["/a"].get.responses[200].content["application/json"].schema).toEqual({
        type: "object",
        properties: { id: { type: "string" } },
      });
    });
  });
});
