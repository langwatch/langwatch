import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { openapiDocumentRoute } from "../openapi-document.ts";

describe("given a REST app with one documented route", () => {
  const restApp = new Hono().get(
    "/api/agents",
    describeRoute({
      summary: "List agents",
      operationId: "listAgents",
      security: [{ project_api_key: [] }],
      responses: { 200: { description: "ok" } },
    }),
    (context) => context.json({ data: [] }),
  );

  const root = new Hono();
  root.get("/api/openapi.json", openapiDocumentRoute(restApp));

  it("describes exactly the routes actually mounted, live, not a frozen snapshot", async () => {
    const response = await root.request("/api/openapi.json");
    expect(response.status).toBe(200);

    const document = await response.json();
    expect(Object.keys(document.paths)).toEqual(["/api/agents"]);
    expect(document.paths["/api/agents"].get.operationId).toBe("listAgents");
  });

  it("declares the same security schemes the frozen document shipped", async () => {
    const response = await root.request("/api/openapi.json");
    const document = await response.json();

    expect(Object.keys(document.components.securitySchemes)).toEqual([
      "project_api_key",
      "admin_api_key",
      "scim_bearer",
      "instance_admin_key",
      "internal_secret",
    ]);
  });
});

describe("given a route whose schema carries a recursive definition", () => {
  const restApp = new Hono().get(
    "/api/prompts/:id",
    describeRoute({
      operationId: "getPrompt",
      responses: {
        200: {
          description: "ok",
          content: {
            "application/json": {
              schema: resolver(z.object({ parameters: z.record(z.string(), z.json()) })),
            },
          },
        },
      },
    }),
    (context) => context.json({ parameters: {} }),
  );

  const root = new Hono();
  root.get("/api/openapi.json", openapiDocumentRoute(restApp));

  async function documentRefs() {
    const response = await root.request("/api/openapi.json");
    const document = await response.json();
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return void node.forEach(walk);
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      if (typeof record.$ref === "string") refs.push(record.$ref);
      expect(record.$defs).toBeUndefined();
      Object.values(record).forEach(walk);
    };
    walk(document);

    return { refs, schemas: Object.keys(document.components.schemas) };
  }

  /** @scenario "A schema with a local $defs block is hoisted into components" */
  it("resolves every published $ref on the second request as well as the first", async () => {
    const first = await documentRefs();
    const second = await documentRefs();

    expect(first.refs.length).toBeGreaterThan(0);
    expect(second.refs).toEqual(first.refs);

    for (const published of [first, second]) {
      for (const ref of published.refs) {
        expect(published.schemas).toContain(ref.replace("#/components/schemas/", ""));
      }
    }
  });
});
