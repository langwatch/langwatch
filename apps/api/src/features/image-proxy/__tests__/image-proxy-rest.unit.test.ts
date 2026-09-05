/**
 * What the image proxy puts on the wire, which is the half of this door that is not about
 * egress at all. The bytes are an attacker's to choose — the URL is the caller's, and the
 * door needs no credential — and they come back on the product's own origin.
 */
import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRestSecurity } from "../../../api-rest.security";
import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition";
import { createImageProxyRestApp } from "../image-proxy-rest";

const egress = vi.hoisted(() => ({ fetchValidatedDestination: vi.fn() }));

vi.mock("@langwatch/egress", () => ({
  createSsrfUrlValidator: () => async (url: string) => new URL(url),
  fetchValidatedDestination: egress.fetchValidatedDestination,
}));

/** A security whose credential services are never reached: the door is public. */
function proxySecurity() {
  const unreachable = <T extends object>(prototype: T): T =>
    new Proxy(prototype, {
      get: (target, property, receiver) =>
        property in target
          ? () => {
              throw new Error(`${String(property)} was reached on the image proxy`);
            }
          : Reflect.get(target, property, receiver),
    });

  return ApiRestSecurity.create({
    apiKeys: unreachable(ApiKeyService.prototype),
    authz: unreachable(AuthzService.prototype),
    organizations: unreachable(OrganizationService.prototype),
    observability: ApiRestObservabilityComposition.create(),
  });
}

function proxy() {
  return createImageProxyRestApp({
    security: proxySecurity(),
    blockLocalHttpCalls: true,
    allowedHosts: [],
  });
}

/** An upstream that answers with the given media type and body. */
function upstreamAnswers(contentType: string, body = "<svg xmlns='http://www.w3.org/2000/svg'/>") {
  egress.fetchValidatedDestination.mockResolvedValue(
    new Response(body, { status: 200, headers: { "content-type": contentType } }),
  );
}

describe("the image proxy", () => {
  beforeEach(() => {
    egress.fetchValidatedDestination.mockReset();
  });

  describe("given an upstream that answers with an active image type", () => {
    /** @scenario Proxied image bytes cannot run script on the product origin */
    it("serves the bytes under a sandbox policy that cannot execute them", async () => {
      upstreamAnswers("image/svg+xml");

      const response = await proxy().request(
        "/api/image-proxy?url=https%3A%2F%2Fattacker.example%2Fpayload.svg",
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(response.headers.get("Content-Disposition")).toBe('inline; filename="payload.svg"');
    });

    /** @scenario A proxied filename cannot inject a response header */
    it("sanitises the filename it takes from the caller's own URL", async () => {
      upstreamAnswers("image/png");

      const response = await proxy().request(
        `/api/image-proxy?url=${encodeURIComponent('https://host.example/a"; x=y')}`,
      );

      expect(response.headers.get("Content-Disposition")).toBe('inline; filename="a___x_y"');
    });
  });

  describe("given an upstream that answers with an ordinary image", () => {
    /** @scenario A proxied image keeps its own media type and stays cacheable */
    it("keeps the media type and drops the upstream's charset parameter", async () => {
      upstreamAnswers("image/png; charset=binary");

      const response = await proxy().request(
        "/api/image-proxy?url=https%3A%2F%2Fhost.example%2Flogo.png",
      );

      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000");
    });
  });

  describe("given an upstream that answers with something that is not an image", () => {
    /** @scenario A proxied response that is not an image is refused */
    it("refuses it rather than relaying it", async () => {
      upstreamAnswers("text/html", "<script>alert(1)</script>");

      const response = await proxy().request(
        "/api/image-proxy?url=https%3A%2F%2Fattacker.example%2Fpayload.html",
      );

      expect(response.status).toBe(400);
    });
  });
});
