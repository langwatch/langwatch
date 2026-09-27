/**
 * The project's key for Langy's credentials call, against a platform that
 * behaves as production does: the project routes refuse to reveal a base key
 * to any API key, and the device session trades for it by slug.
 *
 * @see specs/langy/langy-local-control.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectKeyReader, platformProjectKeyReader } from "../project-key";

const ENDPOINT = "http://app.test";

type Seen = { method: string; path: string; authorization: string | null; body: unknown };

/** The platform: a project lookup, the refused base-key route, the device-session key route. */
function fakePlatform({ keyRouteStatus = 200 }: { keyRouteStatus?: number } = {}) {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
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
      if (method === "POST" && url.pathname === "/api/auth/cli/project-key") {
        if (keyRouteStatus !== 200) {
          return json(keyRouteStatus, {
            error: "forbidden",
            error_description: "You need admin access to this project to retrieve its API key.",
          });
        }
        return json(200, {
          api_key: "sk-lw-acme-project",
          project: { id: "project_acme", slug: "acme-shop", name: "Acme Shop" },
        });
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
  describe("when the developer's device session may manage the project", () => {
    /** @scenario "The project's key comes from the device session, not from the organization key" */
    it("looks the slug up by id and trades the device session for the key", async () => {
      const platform = fakePlatform();
      const read = platformProjectKeyReader({ endpoint: ENDPOINT, apiKey: "sk-lw-org-login" });

      await expect(read("project_acme")).resolves.toBe("sk-lw-acme-project");

      const keyCall = platform.seen.find((call) => call.path === "/api/auth/cli/project-key");
      expect(keyCall).toMatchObject({
        method: "POST",
        authorization: "Bearer lw_at_device_session",
        body: { slug: "acme-shop" },
      });
      expect(platform.seen.map((call) => call.path)).not.toContain(
        "/api/projects/project_acme/api-key",
      );
    });
  });

  describe("when the device session may not manage the project", () => {
    it("rejects with the platform's 403 so the call reads as a refusal", async () => {
      fakePlatform({ keyRouteStatus: 403 });
      const read = platformProjectKeyReader({ endpoint: ENDPOINT, apiKey: "sk-lw-org-login" });

      await expect(read("project_acme")).rejects.toMatchObject({ status: 403 });
    });
  });
});

describe("createProjectKeyReader", () => {
  it("fetches the key for the slug the lookup found", async () => {
    const read = createProjectKeyReader({
      lookupSlug: async (id) => (id === "project_acme" ? "acme-shop" : "other"),
      fetchKeyBySlug: async (slug) => `key-for-${slug}`,
    });
    await expect(read("project_acme")).resolves.toBe("key-for-acme-shop");
  });
});
