/**
 * specs/otlp/endpoint-path-canonicalisation.feature — the host's pre-routing OTLP path alias.
 */
import { OTLP_CORRECTED_PATH_HEADER, readCorrectedPath } from "@langwatch/observability";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { canonicalOtlpRequest, withOtlpPathAliases } from "../otlp-path-alias.ts";

const post = (path: string, body = "batch") =>
  new Request(`http://api.test${path}`, { method: "POST", body });

describe("the OTLP path alias", () => {
  describe("given a misconfigured exporter base", () => {
    /** @scenario The correction names the path the exporter used */
    it("rewrites onto the canonical route and stamps the path the exporter used", async () => {
      const rewritten = canonicalOtlpRequest(post("/api/otel/v1/traces/v1/logs"));

      expect(new URL(rewritten.url).pathname).toBe("/api/otel/v1/logs");
      expect(
        readCorrectedPath(rewritten.headers.get(OTLP_CORRECTED_PATH_HEADER) ?? undefined),
      ).toBe("/api/otel/v1/traces/v1/logs");
      expect(await rewritten.text()).toBe("batch");
    });
  });

  describe("given a canonical or unrelated path", () => {
    /** @scenario An unrelated path that happens to end in a signal name */
    it("leaves the request as it came", () => {
      for (const path of ["/api/otel/v1/metrics", "/elsewhere/v1/metrics", "/api/projects"]) {
        const request = post(path);
        expect(canonicalOtlpRequest(request)).toBe(request);
      }
    });
  });

  describe("when an app declares only the canonical route", () => {
    const app = withOtlpPathAliases(new Hono());
    app.post("/api/otel/v1/metrics", async (context) =>
      context.json({ body: await context.req.text() }),
    );

    it("serves an aliased base from it and answers an unknown base 404", async () => {
      const aliased = await app.fetch(post("/v1/metrics"));
      const unknown = await app.fetch(post("/elsewhere/v1/metrics"));

      expect({ status: aliased.status, body: await aliased.json() }).toEqual({
        status: 200,
        body: { body: "batch" },
      });
      expect(unknown.status).toBe(404);
    });
  });
});
