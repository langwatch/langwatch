import { routeTemplateOf } from "@langwatch/observability/metrics";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { noteMatchedRouteTemplate } from "../api-surface.ts";

describe("given a router that notes the matched template", () => {
  const app = new Hono();
  app.use("*", async (context, next) => {
    await next();
    noteMatchedRouteTemplate(context);
  });
  app.route(
    "/",
    new Hono().get("/api/traces/:id", (context) => context.text("ok")),
  );
  app.all("*", (context) => context.text("nope", 404));

  it("notes the template rather than the requested path", async () => {
    const request = new Request("http://localhost/api/traces/abc-123");
    await app.fetch(request);
    expect(routeTemplateOf(request)).toBe("/api/traces/:id");
  });

  it("notes nothing when only the catch-all matched", async () => {
    const request = new Request("http://localhost/api/whatever/xyz");
    await app.fetch(request);
    expect(routeTemplateOf(request)).toBeUndefined();
  });
});
