/**
 * @vitest-environment node
 *
 * Discovery: the locations an agent tries when it is pointed at a LangWatch
 * instance and given nothing else.
 *
 * Hits the real Hono app with no credentials at all, because the only reason to
 * publish a description at a fixed URL is that a caller can fetch it before it
 * has a token.
 *
 * See specs/api-reference/api-discovery.feature.
 */
import { describe, expect, it } from "vitest";

import { isRootDiscoveryPath } from "~/server/openapi/discovery-locations";
import { app } from "../api-discovery";
import { app as gatewayApp } from "../gateway-openapi";
import { app as rootApp } from "../root-discovery";

/**
 * Discovery is two apps, split so each file declares one basePath and the
 * route-coverage gate reports truthful paths (see api-discovery.ts). A caller
 * meets them as one surface on the mounted router, so the tests address them
 * that way and this picks whichever app owns the path.
 */
const appFor = (path: string) => (isRootDiscoveryPath(path) ? rootApp : app);

const WELL_KNOWN = "/.well-known/openapi";
const UNDER_API = "/api/openapi.json";
const CANONICAL = "/api/gateway/v1/openapi.json";

async function fetchDocument(
  target: typeof app,
  path: string,
): Promise<{ res: Response; document: Record<string, unknown> }> {
  const res = await target.request(path, { method: "GET" });
  return { res, document: (await res.json()) as Record<string, unknown> };
}

describe("API discovery", () => {
  describe("given a caller holding no credential", () => {
    describe("when it requests the well-known location", () => {
      /** @scenario "The description is served at the well-known location" */
      it("serves the OpenAPI document as JSON", async () => {
        const { res, document } = await fetchDocument(rootApp, WELL_KNOWN);

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
        expect(document.openapi).toMatch(/^3\./);
        expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
      });
    });

    describe("when it requests the location under the API namespace", () => {
      /** @scenario "The description is served under the API namespace" */
      it("serves the OpenAPI document as JSON", async () => {
        const { res, document } = await fetchDocument(app, UNDER_API);

        expect(res.status).toBe(200);
        expect(document.openapi).toMatch(/^3\./);
      });
    });

    /**
     * The point of adding locations is that they describe the same API. Three
     * URLs that drift are worse than one URL nobody can find.
     */
    describe("when the document is fetched from every location", () => {
      /** @scenario "Every location serves one document, not three" */
      it("returns the same operations from all three", async () => {
        const wellKnown = await fetchDocument(rootApp, WELL_KNOWN);
        const underApi = await fetchDocument(app, UNDER_API);
        const canonical = await fetchDocument(gatewayApp, CANONICAL);

        const operations = (document: Record<string, unknown>) =>
          Object.keys(document.paths ?? {}).sort();

        expect(operations(underApi.document)).toEqual(
          operations(wellKnown.document),
        );
        expect(operations(canonical.document)).toEqual(
          operations(wellKnown.document),
        );
      });

      /** @scenario "The canonical gateway location keeps answering" */
      it("keeps answering at the location the gateway contract pins", async () => {
        const { res } = await fetchDocument(gatewayApp, CANONICAL);

        expect(res.status).toBe(200);
      });
    });

    /** @scenario "Discovery needs no credential" */
    it("answers rather than demanding a credential", async () => {
      for (const path of [WELL_KNOWN, UNDER_API, "/llms.txt"]) {
        const res = await appFor(path).request(path, { method: "GET" });
        expect(res.status).not.toBe(401);
      }
    });
  });

  describe("given a caller using the wrong method", () => {
    describe("when it POSTs to a document location", () => {
      /** @scenario "A discovery location answers only GET" */
      it("refuses the request", async () => {
        for (const path of [WELL_KNOWN, UNDER_API, "/llms.txt"]) {
          const res = await appFor(path).request(path, { method: "POST" });
          expect(res.status).toBe(404);
        }
      });
    });
  });

  describe("given a reader arriving with no schema in mind", () => {
    describe("when it requests the plain-text index", () => {
      /** @scenario "The plain-text index names the service and points at the schema" */
      it("names LangWatch and links to the document and the catalogue", async () => {
        const res = await rootApp.request("/llms.txt", { method: "GET" });
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/plain");
        expect(text).toContain("# LangWatch");
        expect(text).toContain(WELL_KNOWN);
        expect(text).toContain("/api/rpc.discover");
      });

      /**
       * The middleware accepts three credentials and calls X-Auth-Token legacy
       * in its own comments. Leading a new reader with it would teach the
       * header we intend to retire.
       *
       * @scenario "The plain-text index leads with the credential we want new callers to send"
       */
      it("shows the bearer token first and marks X-Auth-Token legacy", async () => {
        const res = await rootApp.request("/llms.txt", { method: "GET" });
        const text = await res.text();

        expect(text).toContain("Authorization: Bearer");
        expect(text.indexOf("Authorization: Bearer")).toBeLessThan(
          text.indexOf("X-Auth-Token"),
        );
        expect(text).toMatch(/X-Auth-Token[^\n]*\n?[^\n]*legacy/i);
      });

      /**
       * The document is 632 KB minified. An agent that fetches it to answer
       * "what is this service" has spent most of a context window on one
       * sentence, which is the reason this file exists at all.
       *
       * @scenario "The plain-text index stays small enough to read speculatively"
       */
      it("stays orders of magnitude smaller than the document", async () => {
        const index = await (
          await rootApp.request("/llms.txt", { method: "GET" })
        ).text();
        const document = await (
          await rootApp.request(WELL_KNOWN, { method: "GET" })
        ).text();

        expect(index.length).toBeLessThan(4_000);
        expect(index.length * 50).toBeLessThan(document.length);
      });
    });
  });

  describe("given a caller that wants only the RPC operations", () => {
    describe("when it POSTs to the catalogue", () => {
      /** @scenario "Discovering the catalogue is itself an RPC" */
      it("answers a POST at the dotted name", async () => {
        const res = await app.request("/api/rpc.discover", { method: "POST" });

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("application/json");
      });

      /**
       * No family has adopted RPC naming yet, so the catalogue is empty and
       * says so honestly. Deriving it from the document rather than a registry
       * is what makes that require no backfill later.
       *
       * @scenario "The catalogue reports no operation the document does not carry"
       */
      it("reports an empty catalogue that still points at the document", async () => {
        const res = await app.request("/api/rpc.discover", { method: "POST" });
        const catalogue = (await res.json()) as {
          openapi: string;
          operations: unknown[];
        };

        expect(catalogue.operations).toEqual([]);
        expect(catalogue.openapi).toBe(WELL_KNOWN);
      });
    });

    describe("when it GETs the catalogue", () => {
      it("refuses, because an RPC is a POST", async () => {
        const res = await app.request("/api/rpc.discover", { method: "GET" });

        expect(res.status).toBe(404);
      });
    });
  });

  /**
   * start.ts dispatches on this. It is the piece that silently regresses: drop
   * a path from it and no handler test fails — the handler is fine, it just
   * stops being reachable, and the SPA fallback answers with the HTML shell and
   * a 200 that the caller reads as success.
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
      /** @scenario "Root-level discovery paths reach the API, not the SPA fallback" */
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
  });
});
