import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { browserBundleDoor, type BrowserBundle } from "../browser-bundle.ts";
import { Server } from "../server.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const activeServers: Server[] = [];

let directory: string;

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "browser-bundle-"));
  fs.mkdirSync(path.join(directory, "assets"));
  fs.writeFileSync(
    path.join(directory, "index.html"),
    "<!doctype html><html><head><title>app</title></head><body></body></html>",
  );
  fs.writeFileSync(path.join(directory, "assets", "main-a1b2.js"), "console.log(1)");
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

/** One request to a server whose door carries this bundle and nothing else. */
async function answerOf(
  bundle: BrowserBundle,
  request: { path: string; method?: string },
): Promise<Response> {
  const server = Server.create({ name: "bundle-test", logger, ownsProcess: false });
  activeServers.push(server);
  server.with(browserBundleDoor(bundle));
  await server.listen();
  const address = server.healthAddress;
  if (address === null || typeof address === "string") {
    throw new Error("the door bound no IP port");
  }
  const { port } = address satisfies AddressInfo;

  return fetch(`http://127.0.0.1:${port}${request.path}`, { method: request.method ?? "GET" });
}

describe("browser bundle door", () => {
  describe("given a request for an address no transport claimed", () => {
    describe("when the bundle is on disk", () => {
      /** @scenario "The browser application answers an unclaimed address" */
      it("answers the shell, so the single page application routes it", async () => {
        const response = await answerOf({ directory }, { path: "/settings/members" });

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        await expect(response.text()).resolves.toContain("<title>app</title>");
      });
    });
  });

  describe("given this deployment injects its public configuration", () => {
    describe("when the shell is served", () => {
      /** @scenario "The served page carries this deployment's configuration" */
      it("injects it at the start of the head, before the bundle's own scripts", async () => {
        const response = await answerOf(
          { directory, head: '<meta name="langwatch-public-config" content="abc">' },
          { path: "/" },
        );

        await expect(response.text()).resolves.toContain(
          '<head><meta name="langwatch-public-config" content="abc">',
        );
      });
    });
  });

  describe("given the deployment states its own security headers", () => {
    describe("when the shell is served", () => {
      /** @scenario "The served page carries this deployment's security headers" */
      it("sends them with the document the browser reads them off", async () => {
        const response = await answerOf(
          { directory, headers: { "X-Content-Type-Options": "nosniff" } },
          { path: "/" },
        );

        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      });
    });
  });

  describe("given a request for a content-hashed asset", () => {
    describe("when the asset exists", () => {
      /** @scenario "A built asset is served" */
      it("serves it with an immutable cache", async () => {
        const response = await answerOf({ directory }, { path: "/assets/main-a1b2.js" });

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe(
          "public, max-age=31536000, immutable",
        );
      });
    });

    describe("when the asset is gone", () => {
      /** @scenario "A built asset is missing" */
      it("answers 404 rather than the shell", async () => {
        const response = await answerOf({ directory }, { path: "/assets/removed-9f9f.js" });

        expect(response.status).toBe(404);
        await expect(response.text()).resolves.toBe("Not Found");
      });
    });
  });

  describe("given a request that is not a page load", () => {
    describe("when it arrives", () => {
      /** @scenario "A write is never answered by the browser application" */
      it("declines it, so the door answers as it would with no bundle at all", async () => {
        const response = await answerOf({ directory }, { path: "/api/anything", method: "POST" });

        expect(response.status).toBe(404);
        await expect(response.text()).resolves.toBe("");
      });
    });
  });

  describe("given a deployment that carries no build", () => {
    describe("when a page is requested", () => {
      /** @scenario "The deployment carries no browser build" */
      it("answers 404 rather than an empty page", async () => {
        const response = await answerOf(
          { directory: path.join(directory, "absent") },
          { path: "/" },
        );

        expect(response.status).toBe(404);
      });
    });
  });
});
