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
import { isRootDiscoveryPath } from "../discovery-locations";
import { Hono } from "hono";

const running: ApiHttpListener[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((listener) => listener.close()));
});

describe("given the API process's discovery locations", () => {
  describe("when a caller with no credential asks for the description", () => {
    /** @scenario "The description is served at the well-known location" */
    /** @scenario "The description is served under the API namespace" */
    /** @scenario "The canonical gateway location keeps answering" */
    /** @scenario "Every location offers the same entity tag for the same document" */
    /** @scenario "Discovery needs no credential" */
    it("answers the identical document at all three published URLs", async () => {
      const api = await startApi();

      const [gateway, underApi, wellKnown] = await Promise.all([
        api.fetch("/api/gateway/v1/openapi.json"),
        api.fetch("/api/openapi.json"),
        api.fetch("/.well-known/openapi"),
      ]);

      expect([gateway.status, underApi.status, wellKnown.status]).toEqual([200, 200, 200]);
      for (const response of [gateway, underApi, wellKnown]) {
        expect(response.status).not.toBe(401);
      }
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

    /** @scenario "Every location serves one document, not three" */
    it("returns the same operations from all three locations", async () => {
      const api = await startApi();

      const [gateway, underApi, wellKnown] = await Promise.all([
        api.fetch("/api/gateway/v1/openapi.json"),
        api.fetch("/api/openapi.json"),
        api.fetch("/.well-known/openapi"),
      ]);

      const operations = async (response: Response) =>
        Object.keys(
          ((await response.json()) as { paths?: Record<string, unknown> }).paths ?? {},
        ).sort();

      const [gatewayOps, underApiOps, wellKnownOps] = await Promise.all([
        operations(gateway),
        operations(underApi),
        operations(wellKnown),
      ]);
      expect(underApiOps).toEqual(wellKnownOps);
      expect(gatewayOps).toEqual(wellKnownOps);
    });

    /** @scenario "A discovery location answers only GET" */
    it("refuses a POST to a document location", async () => {
      const api = await startApi();

      for (const path of ["/.well-known/openapi", "/api/openapi.json", "/llms.txt"]) {
        const res = await api.fetch(path, { method: "POST" });
        expect(res.status).toBe(404);
      }
    });

    /** @scenario "Fetching the document twice returns the same document" */
    it("returns byte-identical responses declaring their own length", async () => {
      const api = await startApi();

      const first = await api.fetch("/.well-known/openapi");
      const second = await api.fetch("/.well-known/openapi");

      const firstBody = await first.text();
      const secondBody = await second.text();

      expect(firstBody).toBe(secondBody);
      expect(first.headers.get("content-length")).toBe(
        String(Buffer.byteLength(firstBody, "utf8")),
      );
    });

    /** @scenario "A caller that already holds the document is told so" */
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
      /** @scenario "A caller holding a stale tag gets the document" */
      expect(stale.status).toBe(200);
      expect((await stale.text()).length).toBeGreaterThan(0);
    });

    /** @scenario "The plain-text index names the service and points at the schema" */
    /** @scenario "A trailing slash still reaches the API" */
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

    /** @scenario "The plain-text index leads with the credential we want new callers to send" */
    it("shows the bearer token first and marks X-Auth-Token legacy", async () => {
      const api = await startApi();
      const res = await api.fetch("/llms.txt");
      const text = await res.text();

      expect(text).toContain("Authorization: Bearer");
      expect(text.indexOf("Authorization: Bearer")).toBeLessThan(text.indexOf("X-Auth-Token"));
      expect(text).toMatch(/X-Auth-Token[^\n]*\n?[^\n]*legacy/i);
    });

    /**
     * The document is minified and large. An agent that fetches it to answer
     * "what is this service" has spent most of a context window on one
     * sentence, which is the reason the plain-text index exists at all.
     */
    /** @scenario "The plain-text index stays small enough to read speculatively" */
    it("stays orders of magnitude smaller than the document", async () => {
      const api = await startApi();
      const index = await (await api.fetch("/llms.txt")).text();
      const document = await (await api.fetch("/.well-known/openapi")).text();

      expect(index.length).toBeLessThan(4_000);
      expect(index.length * 50).toBeLessThan(document.length);
    });
  });
});

/**
 * start.ts (the dev/prod host) dispatches root-level paths on this function.
 * It is the piece that silently regresses: drop a path from it and no handler
 * test fails — the handler is fine, it just stops being reachable, and the
 * SPA fallback answers with the HTML shell and a 200 that the caller reads as
 * success.
 */
describe("given the server deciding where a request goes", () => {
  describe("when the path is a root-level discovery location", () => {
    /** @scenario "Root-level discovery paths reach the API, not the SPA fallback" */
    it("routes it to the API", () => {
      expect(isRootDiscoveryPath("/.well-known/openapi")).toBe(true);
      expect(isRootDiscoveryPath("/llms.txt")).toBe(true);
    });
  });

  describe("when the path belongs to the single-page app", () => {
    /** @scenario "A path that merely starts with a discovery path is left to the app" */
    it("leaves it alone", () => {
      for (const path of [
        "/",
        "/llms.txt/extra",
        "/.well-known/openapi.json",
        "/.well-known/oauth-authorization-server",
        "/settings",
      ]) {
        expect(isRootDiscoveryPath(path)).toBe(false);
      }
    });
  });

  describe("when the path carries a trailing slash", () => {
    /** @scenario "A trailing slash still reaches the API" */
    it("dispatches it to the API", () => {
      expect(isRootDiscoveryPath("/.well-known/openapi/")).toBe(true);
      expect(isRootDiscoveryPath("/llms.txt/")).toBe(true);
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
