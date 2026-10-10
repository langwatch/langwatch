/**
 * The project's key for Langy's credentials call, against a platform that refuses to reveal
 * a base key to any API key: a child of the device session mints an ingestion key by slug.
 * @see specs/langy/langy-local-control.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectKeyReader, platformProjectKeyReader } from "../project-key";

const ENDPOINT = "http://app.test";

type Seen = { method: string; path: string; authorization: string | null; body: unknown };

function requestUrl(input: string | URL | Request): string | URL {
  return input instanceof Request ? input.url : input;
}

/** The platform: a project lookup, the refused base-key route, the fork, the mint, the logout. */
function fakePlatform({ forkStatus = 200 }: { forkStatus?: number } = {}) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(requestUrl(input));
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      seen.push({ method, path: url.pathname, authorization: headers.get("authorization"), body });
      const json = (status: number, value: unknown) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (method === "GET" && url.pathname === "/api/projects/project_acme") {
        return json(200, { id: "project_acme", slug: "acme-shop", name: "Acme Shop" });
      }
      if (url.pathname === "/api/projects/project_acme/api-key") {
        return json(403, {
          error: "A signed-in project administrator must manage the base API key in the browser",
        });
      }
      if (method === "POST" && url.pathname === "/api/auth/cli/refresh") {
        if (forkStatus !== 200) {
          return json(forkStatus, {
            error: "forbidden",
            error_description: "Project not found or you do not have access to it",
          });
        }
        return json(200, {
          access_token: "lw_at_child",
          refresh_token: "lw_rt_child",
          expires_in: 3600,
          project: { id: "project_acme", slug: "acme-shop", name: "Acme Shop" },
        });
      }
      if (method === "POST" && url.pathname === "/api/v1/api-keys/ingestion") {
        return json(201, { token: "sk-lw-acme-ingest", apiKey: { id: "k1", name: "n" } });
      }
      if (method === "POST" && url.pathname === "/api/auth/cli/logout") {
        return json(200, { ok: true });
      }
      return json(404, { error: "not_found" });
    }),
  );
  return { seen };
}

let configDir: string;

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), "langy-project-key-"));
  const configFile = path.join(configDir, "config.json");
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      control_plane_url: ENDPOINT,
      access_token: "lw_at_device_session",
      refresh_token: "lw_rt_device_session",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  vi.stubEnv("LANGWATCH_CLI_CONFIG", configFile);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe("platformProjectKeyReader", () => {
  describe("when the developer's device session may send the project traces", () => {
    /** @scenario "The project's key comes from the device session, not from the organization key" */
    it("looks the slug up by id and mints the ingestion key with a child session", async () => {
      const platform = fakePlatform();
      const read = platformProjectKeyReader({ endpoint: ENDPOINT, apiKey: "sk-lw-org-login" });

      await expect(read("project_acme")).resolves.toBe("sk-lw-acme-ingest");

      expect(platform.seen.find((call) => call.path === "/api/auth/cli/refresh")).toMatchObject({
        method: "POST",
        body: { refresh_token: "lw_rt_device_session", project_slug: "acme-shop" },
      });
      expect(
        platform.seen.find((call) => call.path === "/api/v1/api-keys/ingestion"),
      ).toMatchObject({ method: "POST", authorization: "Bearer lw_at_child" });
      expect(platform.seen.map((call) => call.path)).toContain("/api/auth/cli/logout");
      expect(platform.seen.map((call) => call.path)).not.toContain(
        "/api/projects/project_acme/api-key",
      );
    });
  });

  describe("when the device session cannot reach the project", () => {
    it("rejects with the platform's 403 so the call reads as a refusal", async () => {
      fakePlatform({ forkStatus: 403 });
      const read = platformProjectKeyReader({ endpoint: ENDPOINT, apiKey: "sk-lw-org-login" });

      await expect(read("project_acme")).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe("createProjectKeyReader", () => {
  describe("given a lookup that finds the project's slug", () => {
    describe("when the key is read by the project's id", () => {
      it("fetches the key for the slug the lookup found", async () => {
        const read = createProjectKeyReader({
          lookupSlug: async (id) => (id === "project_acme" ? "acme-shop" : "other"),
          fetchKeyBySlug: async (slug) => `key-for-${slug}`,
        });
        await expect(read("project_acme")).resolves.toBe("key-for-acme-shop");
      });
    });
  });

  describe("given a lookup the platform refuses", () => {
    describe("when the key is read", () => {
      it("names the lookup as the step that failed and keeps its status", async () => {
        const fetched: string[] = [];
        const read = createProjectKeyReader({
          lookupSlug: async () => {
            throw Object.assign(new Error("Insufficient permissions"), { status: 403 });
          },
          fetchKeyBySlug: async (slug) => (fetched.push(slug), "never"),
        });
        await expect(read("project_acme")).rejects.toMatchObject({
          stage: "lookup",
          status: 403,
        });
        expect(fetched).toEqual([]);
      });
    });
  });

  describe("given a key exchange the platform refuses", () => {
    describe("when the key is read", () => {
      it("names the key as the step that failed, with its status and code", async () => {
        const read = createProjectKeyReader({
          lookupSlug: async () => "acme-shop",
          fetchKeyBySlug: async () => {
            throw Object.assign(new Error("No project"), {
              status: 404,
              code: "project_not_found",
            });
          },
        });
        await expect(read("project_acme")).rejects.toMatchObject({
          stage: "key",
          status: 404,
          code: "project_not_found",
        });
      });
    });
  });
});
