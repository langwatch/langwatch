import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithCredentialHolder, setResolvedProjectId } from "@/internal/credentialContext";

import { VirtualKeysApiService } from "../virtual-keys-api.service";

/**
 * The virtual key routes act on one project, so a key that reaches several has to name it.
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

  describe("when the request resolved a project", () => {
    /** @scenario "virtual key commands name the project the login key resolved" */
    it("names that project when listing", async () => {
      mockFetch.mockResolvedValueOnce(emptyPage());

      await runWithCredentialHolder(async () => {
        setResolvedProjectId("project_personal");
        await new VirtualKeysApiService().list();
      });

      expect(projectHeaderOf(0)).toBe("project_personal");
    });

    /** @scenario "virtual key commands follow --project" */
    it("names that project when reading a key's spend", async () => {
      mockFetch.mockResolvedValueOnce(spendSummary());

      await runWithCredentialHolder(async () => {
        setResolvedProjectId("proj-b");
        await new VirtualKeysApiService().spend("vk_1");
      });

      expect(projectHeaderOf(0)).toBe("proj-b");
    });

    it("prefers it over LANGWATCH_PROJECT_ID", async () => {
      process.env.LANGWATCH_PROJECT_ID = "project_from_env";
      mockFetch.mockResolvedValueOnce(emptyPage());

      await runWithCredentialHolder(async () => {
        setResolvedProjectId("project_personal");
        await new VirtualKeysApiService().list();
      });

      expect(projectHeaderOf(0)).toBe("project_personal");
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
