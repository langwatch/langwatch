import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock createLangWatchApiClient so we can return controlled responses for every
// endpoint the status command queries. Status hits ~10 resources in parallel;
// we want a deterministic mix of success/failure per test.
const mockGET = vi.fn();
vi.mock("@/internal/api/client", () => ({
  createLangWatchApiClient: () => ({ GET: mockGET }),
}));

vi.mock("../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

import { statusCommand } from "../status";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

describe("statusCommand", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError((code as number) ?? 0);
    });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    process.env.LANGWATCH_API_KEY = "test-key";
    process.env.LANGWATCH_ENDPOINT = "http://localhost:9876";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("when every resource fetch fails with 401", () => {
    beforeEach(() => {
      // openapi-fetch returns { error, response } on !ok, not { data }.
      mockGET.mockResolvedValue({
        data: undefined,
        error: { error: "Unauthorized", message: "Invalid API key" },
        response: { status: 401 } as Response,
      });
      // suites/triggers/monitors/secrets use raw fetch.
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ error: "Unauthorized", message: "Invalid API key" }),
      }) as unknown as typeof fetch;
    });

    it("prints an auth-specific diagnostic", async () => {
      await expect(statusCommand()).rejects.toThrow(ProcessExitError);

      const combined = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join("\n");

      // The user needs to know that (1) fetches failed, (2) the reason is auth,
      // and (3) what to do next. Without this they see a grid of "fetch failed".
      expect(combined).toContain("Could not fetch any project resources");
      expect(combined).toContain("Invalid API key");
      expect(combined).toContain("langwatch login");
    });

    it("exits with code 1 so scripts can detect the failure", async () => {
      await expect(statusCommand()).rejects.toMatchObject({ code: 1 });
    });
  });

  describe("when every resource fetch fails with a non-auth status", () => {
    beforeEach(() => {
      mockGET.mockResolvedValue({
        data: undefined,
        error: { error: "ServiceUnavailable", message: "Backend down" },
        response: { status: 503 } as Response,
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: async () => ({ error: "ServiceUnavailable", message: "Backend down" }),
      }) as unknown as typeof fetch;
    });

    it("hints at LANGWATCH_API_KEY and reminds the user which endpoint is in use", async () => {
      await expect(statusCommand()).rejects.toThrow(ProcessExitError);

      const combined = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join("\n");

      // When it's not auth (e.g. 503), we shouldn't falsely claim the key is
      // invalid — show the endpoint so the user can verify it instead.
      expect(combined).not.toContain("langwatch login");
      expect(combined).toContain("http://localhost:9876");
      expect(combined).toContain("LANGWATCH_API_KEY");
    });
  });

  describe("when network fails entirely (ECONNREFUSED)", () => {
    beforeEach(() => {
      const cause = Object.assign(new Error(""), { code: "ECONNREFUSED" });
      const err = Object.assign(new TypeError("fetch failed"), { cause });
      mockGET.mockRejectedValue(err);
      global.fetch = vi.fn().mockRejectedValue(err) as unknown as typeof fetch;
    });

    it("surfaces ECONNREFUSED in the diagnostic", async () => {
      await expect(statusCommand()).rejects.toThrow(ProcessExitError);

      const combined = [
        ...consoleLogSpy.mock.calls.flat(),
        ...consoleErrorSpy.mock.calls.flat(),
      ].join("\n");

      expect(combined).toContain("ECONNREFUSED");
      expect(combined).toContain("http://localhost:9876");
    });
  });
});
