/**
 * @vitest-environment node
 *
 * GET /api/gateway/v1/openapi.json is the machine-readable description of the
 * public REST API, promised at that exact URL by
 * specs/ai-gateway/_shared/contract.md section 12.
 *
 * Hits the real Hono app with no credentials at all, because the only reason
 * to publish the document at a fixed URL is that a client generator can fetch
 * it before it has a token.
 */
import { describe, expect, it } from "vitest";

import { app } from "../gateway-openapi";

const PATH = "/api/gateway/v1/openapi.json";

describe("GET /api/gateway/v1/openapi.json", () => {
  it("serves the spec as JSON to an unauthenticated caller", async () => {
    const res = await app.request(PATH, { method: "GET" });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const document = (await res.json()) as {
      openapi?: unknown;
      paths?: Record<string, unknown>;
    };

    expect(typeof document.openapi).toBe("string");
    expect(document.openapi).toMatch(/^3\./);

    const gatewayPaths = Object.keys(document.paths ?? {}).filter((path) =>
      path.startsWith("/api/gateway/v1"),
    );
    expect(gatewayPaths.length).toBeGreaterThan(0);
  });

  it("does not answer other methods on the spec path", async () => {
    const res = await app.request(PATH, { method: "POST" });

    expect(res.status).toBe(404);
  });
});
