import { describe, expect, it } from "vitest";

import { resolveOperation } from "../docs-openapi.mjs";
import { docsFixture } from "./docs.fixture.ts";

describe("when operations use shared schemas and security", () => {
  /** @scenario "Resolve OpenAPI references and request metadata" */
  it("resolves references, recursion, server prefixes and explicit examples", () => {
    const fixture = docsFixture({
      config: {},
      main: {
        servers: [{ url: "https://api.example.com/v1/" }],
        security: [{ token: [] }],
        components: {
          securitySchemes: { token: { type: "apiKey", in: "header", name: "X-Auth-Token" } },
          schemas: {
            Trace: {
              type: "object",
              properties: {
                name: { type: "string" },
                child: { $ref: "#/components/schemas/Trace" },
              },
            },
          },
          parameters: {
            Id: { name: "id", in: "path", required: true, schema: { type: "string" } },
          },
        },
        paths: {
          "/traces/{id}": {
            parameters: [{ $ref: "#/components/parameters/Id" }],
            post: {
              summary: "Create trace",
              parameters: [
                {
                  name: "format",
                  in: "query",
                  description: "Deprecated: use view",
                  schema: { enum: ["json"] },
                },
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Trace" },
                    examples: { sample: { value: { name: "demo" } } },
                  },
                },
              },
              responses: {
                "201": {
                  description: "Created",
                  content: { "application/json": { schema: { type: "boolean" }, example: false } },
                },
                "204": { description: "Empty" },
              },
            },
          },
        },
      },
    });
    try {
      const operation = resolveOperation({
        docsRoot: fixture.docsRoot,
        openapi: "POST /traces/{id}",
      });
      expect(operation).toMatchObject({
        method: "POST",
        path: "/v1/traces/{id}",
        origin: "https://api.example.com",
        schemes: [{ id: "token", name: "X-Auth-Token" }],
        parameters: [
          { name: "id", required: true, in: "path" },
          { name: "format", deprecated: true },
        ],
        body: {
          required: true,
          contents: [
            {
              example: { name: "demo" },
              schema: { properties: { child: { $recursive: "Trace" } } },
            },
          ],
        },
        responses: [
          { status: "201", contents: [{ example: false }] },
          { status: "204", contents: [] },
        ],
      });
    } finally {
      fixture.dispose();
    }
  });
});

describe("when an operation belongs to the evaluation specification", () => {
  /** @scenario "Resolve evaluation operations and absent endpoints" */
  it("reads the second spec and returns absence for an unknown method or path", () => {
    const fixture = docsFixture({
      config: {},
      evals: {
        servers: [{ url: "https://eval.example.com" }],
        paths: {
          "/evaluate": {
            post: { security: [], responses: { "200": { description: "Evaluated" } } },
          },
        },
      },
    });
    try {
      expect(
        resolveOperation({ docsRoot: fixture.docsRoot, openapi: "POST /evaluate" }),
      ).toMatchObject({ origin: "https://eval.example.com", method: "POST", schemes: [] });
      expect(resolveOperation({ docsRoot: fixture.docsRoot, openapi: "GET /evaluate" })).toBeNull();
      expect(resolveOperation({ docsRoot: fixture.docsRoot, openapi: "POST /missing" })).toBeNull();
    } finally {
      fixture.dispose();
    }
  });
});
