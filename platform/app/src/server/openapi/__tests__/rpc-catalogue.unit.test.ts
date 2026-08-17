/**
 * @vitest-environment node
 *
 * The RPC catalogue is a projection of the OpenAPI document. Every claim here
 * follows from that, which is why they are worth pinning: the day someone
 * "optimises" it into a registry that families write to, these stop holding.
 *
 * See specs/api-reference/api-discovery.feature.
 */
import { describe, expect, it } from "vitest";

import { buildRpcCatalogue } from "../rpc-catalogue";

const OPENAPI_URL = "/.well-known/openapi";

const build = (paths: Record<string, unknown>, components?: unknown) =>
  buildRpcCatalogue({
    document: { paths, ...(components ? { components } : {}) },
    openapiUrl: OPENAPI_URL,
  });

const rollSecret = {
  post: {
    operationId: "rollWebhookEndpointSecret",
    summary: "Roll an endpoint's signing secret",
    requestBody: {
      content: {
        "application/json": {
          schema: { type: "object", properties: { id: { type: "string" } } },
        },
      },
    },
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/WebhookEndpoint" },
          },
        },
      },
    },
  },
};

describe("the RPC catalogue", () => {
  describe("given a document carrying a dotted RPC operation", () => {
    describe("when the catalogue is built", () => {
      /** @scenario "The catalogue reports the RPC operations the document publishes" */
      it("lists it by dotted name with the path to POST to", () => {
        const catalogue = build({
          "/api/webhooks/endpoints.rollSecret": rollSecret,
        });

        expect(catalogue.operations).toHaveLength(1);
        expect(catalogue.operations[0]).toMatchObject({
          name: "endpoints.rollSecret",
          path: "/api/webhooks/endpoints.rollSecret",
          operationId: "rollWebhookEndpointSecret",
          status: 200,
        });
      });

      /** @scenario "The catalogue reports the RPC operations the document publishes" */
      it("carries the argument and result schemas from that same document", () => {
        const catalogue = build(
          { "/api/webhooks/endpoints.rollSecret": rollSecret },
          { schemas: { WebhookEndpoint: { type: "object" } } },
        );

        expect(catalogue.operations[0]?.input).toEqual({
          type: "object",
          properties: { id: { type: "string" } },
        });
        expect(catalogue.operations[0]?.output).toEqual({
          $ref: "#/components/schemas/WebhookEndpoint",
        });
        expect(catalogue.components).toEqual({
          WebhookEndpoint: { type: "object" },
        });
      });
    });
  });

  describe("given an operation that takes no arguments", () => {
    describe("when the catalogue is built", () => {
      it("reports a null input rather than omitting the operation", () => {
        const catalogue = build({
          "/api/webhooks/endpoints.list": {
            post: {
              responses: {
                "200": {
                  content: {
                    "application/json": { schema: { type: "array" } },
                  },
                },
              },
            },
          },
        });

        expect(catalogue.operations[0]?.input).toBeNull();
        expect(catalogue.operations[0]?.output).toEqual({ type: "array" });
      });
    });
  });

  /**
   * `assertStatusInvariant` in `@langwatch/api` refuses a registration whose
   * success status could move, so reading the first 2xx is reading a decision
   * the framework already made rather than guessing between several.
   */
  describe("given an operation answering a non-200 success status", () => {
    describe("when the catalogue is built", () => {
      it("reports the status the operation actually answers", () => {
        const catalogue = build({
          "/api/webhooks/endpoints.create": {
            post: {
              responses: {
                "201": {
                  content: {
                    "application/json": { schema: { type: "object" } },
                  },
                },
                "400": { description: "Bad Request" },
              },
            },
          },
        });

        expect(catalogue.operations[0]?.status).toBe(201);
      });

      it("reports no body for an operation that sends none", () => {
        const catalogue = build({
          "/api/webhooks/endpoints.delete": {
            post: { responses: { "204": { description: "No Content" } } },
          },
        });

        expect(catalogue.operations[0]?.status).toBe(204);
        expect(catalogue.operations[0]?.output).toBeNull();
      });
    });
  });

  describe("given a document carrying no dotted operations", () => {
    describe("when the catalogue is built", () => {
      /** @scenario "The catalogue reports no operation the document does not carry" */
      it("is empty and still points at the document", () => {
        const catalogue = build({});

        expect(catalogue.operations).toEqual([]);
        expect(catalogue.openapi).toBe(OPENAPI_URL);
      });
    });
  });

  describe("given ordinary REST paths", () => {
    describe("when the catalogue is built", () => {
      /** @scenario "A non-RPC path is not reported as an RPC" */
      it("lists none of them", () => {
        const catalogue = build({
          "/api/webhooks/endpoints": { post: { responses: {} } },
          "/api/webhooks/endpoints/{id}": { get: { responses: {} } },
          "/api/trace/{id}": { get: { responses: {} } },
        });

        expect(catalogue.operations).toEqual([]);
      });

      /**
       * The grammar is `@langwatch/api`'s `isRpcPath`, the same one `v.rpc`
       * refuses a registration with — so a name it would have refused is a name
       * the catalogue does not recognise, without a second regex here.
       *
       * @scenario "The catalogue recognises names by the same grammar that registers them"
       */
      it("does not recognise a name v.rpc would have refused", () => {
        const catalogue = build({
          "/api/webhooks/Endpoints.create": { post: { responses: {} } },
          "/api/webhooks/endpoints.roll_secret": { post: { responses: {} } },
          "/api/webhooks/endpoints.": { post: { responses: {} } },
        });

        expect(catalogue.operations).toEqual([]);
      });
    });
  });

  describe("given a dotted path documented under another method", () => {
    describe("when the catalogue is built", () => {
      /** @scenario "A dotted path that is not a POST is not reported as an RPC" */
      it("does not advertise a call that would not work", () => {
        const catalogue = build({
          "/api/webhooks/endpoints.list": { get: { responses: {} } },
        });

        expect(catalogue.operations).toEqual([]);
      });
    });
  });

  describe("given several RPC operations", () => {
    describe("when the catalogue is built", () => {
      it("orders them by path so the response is stable between requests", () => {
        const catalogue = build({
          "/api/webhooks/endpoints.rollSecret": rollSecret,
          "/api/webhooks/endpoints.create": { post: { responses: {} } },
          "/api/things/things.list": { post: { responses: {} } },
        });

        expect(catalogue.operations.map((operation) => operation.path)).toEqual(
          [
            "/api/things/things.list",
            "/api/webhooks/endpoints.create",
            "/api/webhooks/endpoints.rollSecret",
          ],
        );
      });
    });
  });
});
