/**
 * Characterisation of the three discovery locations, through the real Hono app
 * the API process serves.
 *
 * These are the routes that tell a caller what the API is, so what is pinned is
 * the wire: the same bytes at all three URLs, a strong ETag, the conditional
 * 304, the cache policy, and the plain-text index. Every one of them is
 * unauthenticated on purpose — a caller reads the description to learn how to
 * authenticate.
 */
import { ApiKeyService } from "@langwatch/api-key-contract";
import { AuthzService } from "@langwatch/authz-contract";
import { OrganizationService } from "@langwatch/organization-contract";
import type { AppRestSecurity } from "@langwatch/api/rest";
import { afterEach, describe, expect, it } from "vitest";

import { ApiApplication } from "../../../api.application";
import { ApiHttpListener } from "../../../api-http.listener";
import { ApiRestSecurity } from "../../../api-rest.security";
import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition";
import { createApiProcessRestFeatures } from "../../../app-rest/app-rest.process-features";
import { Hono } from "hono";

const running: ApiHttpListener[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((listener) => listener.close()));
});

describe("given the API process's discovery locations", () => {
  describe("when a caller with no credential asks for the description", () => {
    it("answers the identical document at all three published URLs", async () => {
      const api = await startApi();

      const [gateway, underApi, wellKnown] = await Promise.all([
        api.fetch("/api/gateway/v1/openapi.json"),
        api.fetch("/api/openapi.json"),
        api.fetch("/.well-known/openapi"),
      ]);

      expect([gateway.status, underApi.status, wellKnown.status]).toEqual([200, 200, 200]);
      const tags = [gateway, underApi, wellKnown].map((response) => response.headers.get("etag"));
      expect(new Set(tags).size).toBe(1);
      expect(tags[0]).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
      for (const response of [gateway, underApi, wellKnown]) {
        expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
        expect(response.headers.get("cache-control")).toBe("public, max-age=60, must-revalidate");
      }

      const document = (await gateway.json()) as { openapi: string; info: { title: string } };
      expect(document.openapi.startsWith("3.")).toBe(true);
      expect(document.info.title).toBeTypeOf("string");
    });

    it("answers 304 with no body when the caller already holds those bytes", async () => {
      const api = await startApi();
      const first = await api.fetch("/api/openapi.json");
      const etag = first.headers.get("etag");
      expect(etag).toBeTruthy();

      const strong = await api.fetch("/api/openapi.json", {
        headers: { "if-none-match": etag as string },
      });
      const weak = await api.fetch("/api/openapi.json", {
        headers: { "if-none-match": `W/${etag as string}, "something-else"` },
      });
      const wildcard = await api.fetch("/api/openapi.json", {
        headers: { "if-none-match": "*" },
      });
      const stale = await api.fetch("/api/openapi.json", {
        headers: { "if-none-match": '"not-the-tag"' },
      });

      expect([strong.status, weak.status, wildcard.status]).toEqual([304, 304, 304]);
      expect(await strong.text()).toBe("");
      expect(stale.status).toBe(200);
    });

    it("serves the plain-text index, and serves it at the trailing-slash spelling too", async () => {
      const api = await startApi();

      const plain = await api.fetch("/llms.txt");
      const slashed = await api.fetch("/llms.txt/");
      const wellKnownSlashed = await api.fetch("/.well-known/openapi/");

      expect([plain.status, slashed.status, wellKnownSlashed.status]).toEqual([200, 200, 200]);
      expect(plain.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      const body = await plain.text();
      expect(body).toContain("# LangWatch");
      expect(body).toContain("/.well-known/openapi");
      expect(body).toContain("/api/openapi.json");
      expect(await slashed.text()).toBe(body);
    });
  });
});

/** Nothing under test here authenticates or meters, so reaching one is a bug. */
function unreachablePort(what: string): never & (() => never) {
  return (() => {
    throw new Error(`The discovery routes must not reach ${what}.`);
  }) as never & (() => never);
}

async function startApi() {
  const security: AppRestSecurity = ApiRestSecurity.create({
    apiKeys: new Proxy(ApiKeyService.prototype, {}),
    authz: new Proxy(AuthzService.prototype, {}),
    organizations: new Proxy(OrganizationService.prototype, {}),
    observability: ApiRestObservabilityComposition.create(),
  });
  const rest = new Hono();
  for (const feature of createApiProcessRestFeatures({
    security,
    ports: {
      handlerManagedCredential: unreachablePort("credential resolution"),
      rateLimit: unreachablePort("the rate limiter"),
    },
  })) {
    rest.route("/", feature);
  }

  const application = ApiApplication.create({
    rest,
    http: {
      createContext: async () => ({
        actor: () => ({ id: "user-1" }),
        authorize: async () => undefined,
      }),
    },
  });
  if (!application.hono) {
    throw new Error("HTTP application was not composed.");
  }
  const listener = ApiHttpListener.create({
    application: application.hono,
    host: "127.0.0.1",
    port: 0,
  });
  const address = await listener.start();
  running.push(listener);

  return {
    fetch: (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, init),
  };
}
