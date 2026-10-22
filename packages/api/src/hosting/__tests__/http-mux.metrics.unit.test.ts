import { noteRouteTemplate } from "@langwatch/observability/metrics";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpMux } from "../http-mux.ts";

const NAME = "http_server_request_duration_seconds";

describe("given a mux that serves requests", () => {
  let provider = createRecordingMeterProvider();
  beforeEach(() => {
    provider = createRecordingMeterProvider();
    provider.install();
  });
  afterEach(() => provider.uninstall());

  it("records duration by mount prefix, method and status, never the raw path", async () => {
    const mux = HttpMux.create()
      .route("/api", () => new Response("no", { status: 503 }))
      .route("/", () => new Response("page"));

    await mux.fetch(new Request("http://localhost/api/users/abc-123", { method: "POST" }));
    await mux.fetch(new Request("http://localhost/projects/secret-slug"));

    expect(provider.valuesOf(NAME, { http_route: "/api" })).toHaveLength(1);
    expect(provider.valuesOf(NAME, { http_route: "/" })).toHaveLength(1);
    const api = provider.recorded.find((m) => m.attributes.http_route === "/api");
    expect(api?.attributes).toMatchObject({
      http_request_method: "POST",
      http_response_status_code: "503",
      status_class: "5xx",
    });
    const raw = provider.recorded.map((m) => String(m.attributes.http_route));
    expect(raw.some((route) => route.includes("abc-123") || route.includes("secret-slug"))).toBe(
      false,
    );
  });

  it("prefers the template an inner router noted for the request", async () => {
    const mux = HttpMux.create().route("/api", (request) => {
      noteRouteTemplate(request, "/api/users/:id");
      return new Response("ok");
    });

    await mux.fetch(new Request("http://localhost/api/users/42"));

    expect(
      provider.valuesOf(NAME, { http_route: "/api/users/:id", status_class: "2xx" }),
    ).toHaveLength(1);
  });

  it("collapses unknown methods into one series", async () => {
    const mux = HttpMux.create().route("/", () => new Response("ok"));

    await mux.fetch(new Request("http://localhost/", { method: "BREW" }));

    expect(provider.valuesOf(NAME, { http_request_method: "_OTHER" })).toHaveLength(1);
  });

  it("records a 500 when a route throws", async () => {
    const mux = HttpMux.create().route("/api", () => {
      throw new Error("boom");
    });

    await mux.fetch(new Request("http://localhost/api/x"));

    expect(provider.valuesOf(NAME, { http_route: "/api", status_class: "5xx" })).toHaveLength(1);
  });
});
