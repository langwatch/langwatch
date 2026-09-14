/**
 * The discovery app answering as a caller reaches it: real routes, real
 * bytes, no runtime behind them. See packages/api/specs/api-discovery.feature.
 */
import { describe, expect, it } from "vitest";

import {
  API_OPENAPI_PATH,
  LLMS_TXT_PATH,
  WELL_KNOWN_OPENAPI_PATH,
} from "../discovery-locations.ts";
import { createDiscoveryApp } from "../discovery.app.ts";

const DOCUMENT_LOCATIONS = [
  API_OPENAPI_PATH,
  "/api/v1/openapi.json",
  "/api/gateway/v1/openapi.json",
  WELL_KNOWN_OPENAPI_PATH,
] as const;

const app = createDiscoveryApp();

describe("given the discovery app", () => {
  describe("when an unauthenticated caller requests a document location", () => {
    /** @scenario "The description is served at the well-known location" */
    it("serves the OpenAPI document as JSON at the well-known location", async () => {
      const response = await app.request(WELL_KNOWN_OPENAPI_PATH);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const document = (await response.json()) as { openapi?: string };
      expect(document.openapi).toBeDefined();
    });

    /** @scenario "The description is served under the API namespace" */
    it("serves the OpenAPI document as JSON under the API namespace", async () => {
      const response = await app.request(API_OPENAPI_PATH);

      expect(response.status).toBe(200);
      const document = (await response.json()) as { openapi?: string };
      expect(document.openapi).toBeDefined();
    });

    /** @scenario "The canonical gateway location keeps answering" */
    it("keeps answering at the canonical gateway location", async () => {
      const response = await app.request("/api/gateway/v1/openapi.json");

      expect(response.status).toBe(200);
      const document = (await response.json()) as { openapi?: string };
      expect(document.openapi).toBeDefined();
    });

    /** @scenario "Every location serves one document, not three" */
    it("serves the same operations from every location", async () => {
      const bodies = await Promise.all(
        DOCUMENT_LOCATIONS.map(async (path) => (await app.request(path)).text()),
      );

      for (const body of bodies.slice(1)) expect(body).toBe(bodies[0]);
    });

    /** @scenario "Fetching the document twice returns the same document" */
    it("answers repeated fetches with identical content and its exact length", async () => {
      const first = await app.request(API_OPENAPI_PATH);
      const second = await app.request(API_OPENAPI_PATH);
      const firstBody = await first.text();
      const secondBody = await second.text();

      expect(secondBody).toBe(firstBody);
      expect(first.headers.get("content-length")).toBe(
        String(Buffer.byteLength(firstBody, "utf8")),
      );
    });

    /** @scenario "Discovery needs no credential" */
    it("answers with no credential presented", async () => {
      for (const path of [...DOCUMENT_LOCATIONS, LLMS_TXT_PATH]) {
        const response = await app.request(path);
        expect(response.status).toBe(200);
      }
    });
  });

  describe("when a caller offers an entity tag", () => {
    /** @scenario "A caller that already holds the document is told so" */
    it("answers not-modified with no body for the current tag", async () => {
      const fresh = await app.request(API_OPENAPI_PATH);
      const tag = fresh.headers.get("etag");
      expect(tag).toBeTruthy();

      const conditional = await app.request(API_OPENAPI_PATH, {
        headers: { "if-none-match": tag ?? "" },
      });

      expect(conditional.status).toBe(304);
      expect(await conditional.text()).toBe("");
    });

    it("recognises the tag inside a weak, comma-separated list", async () => {
      const fresh = await app.request(API_OPENAPI_PATH);
      const tag = fresh.headers.get("etag");

      const conditional = await app.request(API_OPENAPI_PATH, {
        headers: { "if-none-match": `"stale", W/${tag}` },
      });

      expect(conditional.status).toBe(304);
    });

    /** @scenario "Every location offers the same entity tag for the same document" */
    it("offers one entity tag across every location", async () => {
      const tags = await Promise.all(
        DOCUMENT_LOCATIONS.map(async (path) => (await app.request(path)).headers.get("etag")),
      );

      expect(tags[0]).toBeTruthy();
      for (const tag of tags.slice(1)) expect(tag).toBe(tags[0]);
    });

    /** @scenario "A caller holding a stale tag gets the document" */
    it("sends the document to a caller holding a stale tag", async () => {
      const response = await app.request(API_OPENAPI_PATH, {
        headers: { "if-none-match": '"not-the-current-tag"' },
      });

      expect(response.status).toBe(200);
      expect((await response.text()).length).toBeGreaterThan(0);
    });
  });

  describe("when a caller POSTs to a discovery location", () => {
    /** @scenario "A discovery location answers only GET" */
    it("refuses the request", async () => {
      for (const path of [...DOCUMENT_LOCATIONS, LLMS_TXT_PATH]) {
        const response = await app.request(path, { method: "POST" });
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  describe("when an unauthenticated caller requests /llms.txt", () => {
    /** @scenario "The plain-text index names the service and points at the schema" */
    it("names LangWatch and links to the OpenAPI document", async () => {
      const response = await app.request(LLMS_TXT_PATH);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");
      const text = await response.text();
      expect(text).toContain("LangWatch");
      expect(text).toContain(WELL_KNOWN_OPENAPI_PATH);
    });

    /** @scenario "The plain-text index leads with the credential we want new callers to send" */
    it("shows the Authorization bearer form first and calls X-Auth-Token legacy", async () => {
      const text = await (await app.request(LLMS_TXT_PATH)).text();

      const bearerAt = text.indexOf("Authorization: Bearer");
      const legacyAt = text.indexOf("X-Auth-Token");
      expect(bearerAt).toBeGreaterThan(-1);
      expect(legacyAt).toBeGreaterThan(bearerAt);
      expect(text).toContain("legacy");
    });

    /** @scenario "The plain-text index stays small enough to read speculatively" */
    it("stays orders of magnitude smaller than the document it points at", async () => {
      const index = await (await app.request(LLMS_TXT_PATH)).text();
      const document = await (await app.request(API_OPENAPI_PATH)).text();

      expect(index.length * 100).toBeLessThan(document.length);
    });
  });

  describe("when a root-level path arrives with a trailing slash", () => {
    /** @scenario "A trailing slash still reaches the API" */
    it("answers the slashed spelling with the same document as the bare path", async () => {
      const bare = await app.request(WELL_KNOWN_OPENAPI_PATH);
      const slashed = await app.request(`${WELL_KNOWN_OPENAPI_PATH}/`);

      expect(slashed.status).toBe(200);
      expect(await slashed.text()).toBe(await bare.text());

      const llms = await app.request(`${LLMS_TXT_PATH}/`);
      expect(llms.status).toBe(200);
    });
  });
});
