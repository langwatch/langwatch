/**
 * What one declared route publishes: the body a caller sends a route that
 * reads its own bytes, and the 3.1 spelling of an exclusive bound.
 *
 * @see specs/api-reference/exclusive-bounds-3-1.feature
 * @see ../../../specs/endpoint-capabilities.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { RestTransportDocs } from "../openapi.ts";
import { normalizeExclusiveBounds, restRouteDocumentation } from "../openapi.ts";
import type { RestTransportRoute } from "../declaration.ts";

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

describe("restRouteDocumentation", () => {
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
