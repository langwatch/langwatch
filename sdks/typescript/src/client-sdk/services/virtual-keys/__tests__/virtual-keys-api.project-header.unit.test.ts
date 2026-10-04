import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runWithCredentialHolder,
  setRequestedProject,
  setResolvedProjectId,
} from "@/internal/credentialContext";

import { VirtualKeysApiService } from "../virtual-keys-api.service";

/**
 * A key that names no project answers for every virtual key it can see, so only a project the
 * caller asked for is sent.
 * @see specs/typescript-sdk/cli-cross-project-access.feature
 */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const emptyPage = (): Response =>
  new Response(JSON.stringify({ data: [], next_cursor: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const spendSummary = (): Response =>
  new Response(
    JSON.stringify({
      virtual_key_id: "vk_1",
      spent_usd: "0",
      requests: 0,
      window: { from: 0, to: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const createdKey = (): Response =>
  new Response(JSON.stringify({ virtual_key: { id: "vk_1" }, secret: "vk-lw-secret" }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });

/** The X-Project-Id header of the nth fetch, or null when the request sent none. */
const projectHeaderOf = (call: number): string | null => {
  const init = mockFetch.mock.calls[call]![1] as RequestInit;
  return new Headers(init.headers).get("X-Project-Id");
};

describe("VirtualKeysApiService project header", () => {
  const previous = {
    apiKey: process.env.LANGWATCH_API_KEY,
    endpoint: process.env.LANGWATCH_ENDPOINT,
    projectId: process.env.LANGWATCH_PROJECT_ID,
  };

  beforeEach(() => {
    mockFetch.mockReset();
    process.env.LANGWATCH_API_KEY = "sk-lw-test";
    process.env.LANGWATCH_ENDPOINT = "https://api.langwatch.test";
    delete process.env.LANGWATCH_PROJECT_ID;
  });

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("LANGWATCH_API_KEY", previous.apiKey);
    restore("LANGWATCH_ENDPOINT", previous.endpoint);
    restore("LANGWATCH_PROJECT_ID", previous.projectId);
  });

  describe("when the request resolved a project the command line did not name", () => {
    /** @scenario "virtual key commands answer for everything the login key reaches" */
    it("names no project when listing, so every visible key is listed", async () => {
      mockFetch.mockResolvedValueOnce(emptyPage());

      await runWithCredentialHolder(async () => {
        setResolvedProjectId("project_personal");
        await new VirtualKeysApiService().list();
      });

      expect(projectHeaderOf(0)).toBeNull();
    });

    it("names no project when reading a key's spend", async () => {
      mockFetch.mockResolvedValueOnce(spendSummary());

      await runWithCredentialHolder(async () => {
        setResolvedProjectId("project_personal");
        await new VirtualKeysApiService().spend("vk_1");
      });

      expect(projectHeaderOf(0)).toBeNull();
    });

    /** @scenario "a virtual key created with no scope lands in the resolved project" */
    it("names it when creating a key with no scope", async () => {
      mockFetch.mockResolvedValueOnce(createdKey());

      await runWithCredentialHolder(async () => {
        setResolvedProjectId("project_personal");
        await new VirtualKeysApiService().create({ name: "ci" });
      });

      expect(projectHeaderOf(0)).toBe("project_personal");
    });

    it("names no project when creating a key that says its scopes", async () => {
      mockFetch.mockResolvedValueOnce(createdKey());

      await runWithCredentialHolder(async () => {
        setResolvedProjectId("project_personal");
        await new VirtualKeysApiService().create({
          name: "ci",
          scopes: [{ scope_type: "team", scope_id: "team_1" }],
        });
      });

      expect(projectHeaderOf(0)).toBeNull();
    });
  });

  describe("when the command line named a project", () => {
    /** @scenario "virtual key commands follow --project" */
    it("names the project it resolved to when reading a key's spend", async () => {
      mockFetch.mockResolvedValueOnce(spendSummary());

      await runWithCredentialHolder(async () => {
        setRequestedProject("checkout");
        setResolvedProjectId("proj-b");
        await new VirtualKeysApiService().spend("vk_1");
      });

      expect(projectHeaderOf(0)).toBe("proj-b");
    });

    it("prefers it over LANGWATCH_PROJECT_ID", async () => {
      process.env.LANGWATCH_PROJECT_ID = "project_from_env";
      mockFetch.mockResolvedValueOnce(emptyPage());

      await runWithCredentialHolder(async () => {
        setRequestedProject("checkout");
        setResolvedProjectId("proj-b");
        await new VirtualKeysApiService().list();
      });

      expect(projectHeaderOf(0)).toBe("proj-b");
    });
  });

  describe("when the request resolved no project", () => {
    it("falls back to LANGWATCH_PROJECT_ID", async () => {
      process.env.LANGWATCH_PROJECT_ID = "project_from_env";
      mockFetch.mockResolvedValueOnce(emptyPage());

      await runWithCredentialHolder(() => new VirtualKeysApiService().list());

      expect(projectHeaderOf(0)).toBe("project_from_env");
    });

    it("sends no project header for a key that names its own project", async () => {
      mockFetch.mockResolvedValueOnce(emptyPage());

      await runWithCredentialHolder(() => new VirtualKeysApiService().list());

      expect(projectHeaderOf(0)).toBeNull();
    });
  });
});
