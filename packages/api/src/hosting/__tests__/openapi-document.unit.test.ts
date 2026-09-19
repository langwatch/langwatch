import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { describe, expect, it } from "vitest";

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
