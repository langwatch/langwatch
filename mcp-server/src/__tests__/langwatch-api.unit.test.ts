import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initConfig } from "../config.js";

const TEST_ENDPOINT = "https://test.langwatch.ai";
const TEST_API_KEY = "test-key";

describe("langwatch-api", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    initConfig({ apiKey: TEST_API_KEY, endpoint: TEST_ENDPOINT });
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockJsonResponse(data: unknown, status = 200) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(data),
      json: async () => data,
    });
  }

  function mockErrorResponse(status: number, body: string) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      text: async () => body,
    });
  }

  describe("searchTraces()", () => {
    it("sends POST to /api/traces/search with llmMode", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      const responseData = { traces: [] };
      mockJsonResponse(responseData);

      const result = await searchTraces({
        startDate: 1000,
        endDate: 2000,
        query: "hello",
      });

      const [calledUrl, calledOptions] = mockFetch.mock.calls[0]!;
      expect(calledUrl).toBe(`${TEST_ENDPOINT}/api/traces/search`);
      expect(calledOptions.method).toBe("POST");
      expect(calledOptions.headers["X-Auth-Token"]).toBe(TEST_API_KEY);
      expect(calledOptions.headers["Content-Type"]).toBe("application/json");

      const parsedBody = JSON.parse(calledOptions.body as string);
      expect(parsedBody).toEqual({
        query: "hello",
        startDate: 1000,
        endDate: 2000,
        llmMode: true,
      });
      expect(result).toEqual(responseData);
    });

    describe("when response is not OK", () => {
      it("throws a descriptive error with status code and body", async () => {
        const { searchTraces } = await import("../langwatch-api.js");
        mockErrorResponse(401, "Unauthorized");

        await expect(
          searchTraces({ startDate: 1000, endDate: 2000 })
        ).rejects.toThrow("401");
      });
    });
  });

  describe("getTraceById()", () => {
    it("sends GET to /api/traces/{id}?llmMode=true", async () => {
      const { getTraceById } = await import("../langwatch-api.js");
      const responseData = { trace: { id: "abc" } };
      mockJsonResponse(responseData);

      const result = await getTraceById("abc");

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/traces/abc?llmMode=true`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
          }),
        })
      );
      expect(result).toEqual(responseData);
    });

    it("does not include Content-Type for GET requests", async () => {
      const { getTraceById } = await import("../langwatch-api.js");
      mockJsonResponse({});

      await getTraceById("abc");

      const callHeaders = mockFetch.mock.calls[0]![1]!.headers as Record<
        string,
        string
      >;
      expect(callHeaders["Content-Type"]).toBeUndefined();
    });
  });

  describe("getAnalyticsTimeseries()", () => {
    it("sends POST to /api/analytics/timeseries", async () => {
      const { getAnalyticsTimeseries } = await import("../langwatch-api.js");
      const params = {
        series: [{ metric: "performance.completion_time", aggregation: "avg" }],
        startDate: 1000,
        endDate: 2000,
      };
      const responseData = { data: [] };
      mockJsonResponse(responseData);

      const result = await getAnalyticsTimeseries(params);

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/analytics/timeseries`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(params),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe("listPrompts()", () => {
    it("sends GET to /api/prompts", async () => {
      const { listPrompts } = await import("../langwatch-api.js");
      const responseData = [{ id: "1", name: "test" }];
      mockJsonResponse(responseData);

      const result = await listPrompts();

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/prompts`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
          }),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe("getPrompt()", () => {
    it("sends GET to /api/prompts/{id} with encoded ID", async () => {
      const { getPrompt } = await import("../langwatch-api.js");
      const responseData = { id: "1", name: "test" };
      mockJsonResponse(responseData);

      const result = await getPrompt("my prompt/v1");

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/prompts/${encodeURIComponent("my prompt/v1")}`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
          }),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe("createPrompt()", () => {
    it("sends POST to /api/prompts with body", async () => {
      const { createPrompt } = await import("../langwatch-api.js");
      const data = {
        name: "Test Prompt",
        messages: [{ role: "system", content: "You are helpful." }],
        model: "gpt-4o",
        modelProvider: "openai",
      };
      const responseData = { id: "new-id", ...data };
      mockJsonResponse(responseData);

      const result = await createPrompt(data);

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/prompts`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(data),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe("updatePrompt()", () => {
    it("sends POST to /api/prompts/{id} with body", async () => {
      const { updatePrompt } = await import("../langwatch-api.js");
      const data = {
        messages: [{ role: "system", content: "Updated" }],
        commitMessage: "update system prompt",
      };
      const responseData = { id: "p1", ...data };
      mockJsonResponse(responseData);

      const result = await updatePrompt("p1", data);

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/prompts/${encodeURIComponent("p1")}`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(data),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe("createPromptVersion()", () => {
    it("sends POST to /api/prompts/{id}/versions with body", async () => {
      const { createPromptVersion } = await import("../langwatch-api.js");
      const data = {
        messages: [{ role: "user", content: "new version" }],
        commitMessage: "v2",
      };
      const responseData = { version: 2 };
      mockJsonResponse(responseData);

      const result = await createPromptVersion("p1", data);

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/prompts/${encodeURIComponent("p1")}/versions`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(data),
        })
      );
      expect(result).toEqual(responseData);
    });
  });

  describe("when the API returns an error", () => {
    it("includes the status code in the error message", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      mockErrorResponse(500, "Internal Server Error");

      await expect(
        searchTraces({ startDate: 1000, endDate: 2000 })
      ).rejects.toThrow("500");
    });

    it("includes the response body in the error message", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      mockErrorResponse(403, "Forbidden: invalid API key");

      await expect(
        searchTraces({ startDate: 1000, endDate: 2000 })
      ).rejects.toThrow("Forbidden: invalid API key");
    });
  });
});
