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

  function mock204Response() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: async () => "",
      json: async () => { throw new Error("No content"); },
    });
  }

  describe("searchTraces()", () => {
    it("sends POST to /api/traces/search with format digest by default", async () => {
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
        format: "digest",
      });
      expect(result).toEqual(responseData);
    });

    it("sends format json when specified", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      mockJsonResponse({ traces: [] });

      await searchTraces({
        startDate: 1000,
        endDate: 2000,
        format: "json",
      });

      const parsedBody = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
      expect(parsedBody.format).toBe("json");
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
    it("sends GET to /api/traces/{id}?format=digest by default", async () => {
      const { getTraceById } = await import("../langwatch-api.js");
      const responseData = { trace: { id: "abc" } };
      mockJsonResponse(responseData);

      const result = await getTraceById("abc");

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/traces/abc?format=digest`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "X-Auth-Token": TEST_API_KEY,
          }),
        })
      );
      expect(result).toEqual(responseData);
    });

    it("sends format=json when specified", async () => {
      const { getTraceById } = await import("../langwatch-api.js");
      mockJsonResponse({});

      await getTraceById("abc", "json");

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/traces/abc?format=json`,
        expect.anything()
      );
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
        handle: "test-prompt",
        messages: [{ role: "system", content: "You are helpful." }],
        model: "openai/gpt-4o",
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
    it("sends PUT to /api/prompts/{id} with body", async () => {
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
          method: "PUT",
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

  describe("getPrompt() with tag options", () => {
    describe("when called with tag option", () => {
      it("appends tag query parameter", async () => {
        const { getPrompt } = await import("../langwatch-api.js");
        mockJsonResponse({ id: "1" });

        await getPrompt("pizza-prompt", { tag: "production" });

        expect(mockFetch).toHaveBeenCalledWith(
          `${TEST_ENDPOINT}/api/prompts/${encodeURIComponent("pizza-prompt")}?tag=production`,
          expect.objectContaining({ method: "GET" })
        );
      });
    });

    describe("when called with version option", () => {
      it("appends version query parameter", async () => {
        const { getPrompt } = await import("../langwatch-api.js");
        mockJsonResponse({ id: "1" });

        await getPrompt("pizza-prompt", { version: 2 });

        expect(mockFetch).toHaveBeenCalledWith(
          `${TEST_ENDPOINT}/api/prompts/${encodeURIComponent("pizza-prompt")}?version=2`,
          expect.objectContaining({ method: "GET" })
        );
      });
    });

    describe("when called with no options", () => {
      it("sends no query string", async () => {
        const { getPrompt } = await import("../langwatch-api.js");
        mockJsonResponse({ id: "1" });

        await getPrompt("pizza-prompt");

        expect(mockFetch).toHaveBeenCalledWith(
          `${TEST_ENDPOINT}/api/prompts/${encodeURIComponent("pizza-prompt")}`,
          expect.objectContaining({ method: "GET" })
        );
      });
    });
  });

  describe("createPrompt() with tags", () => {
    describe("when called with tags", () => {
      it("includes tags in the request body", async () => {
        const { createPrompt } = await import("../langwatch-api.js");
        const data = {
          handle: "test",
          messages: [{ role: "system", content: "hi" }],
          model: "openai/gpt-5-mini",
          tags: ["production", "staging"],
        };
        mockJsonResponse({ id: "new" });

        await createPrompt(data);

        const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
        expect(body.tags).toEqual(["production", "staging"]);
      });
    });
  });

  describe("updatePrompt() with tags", () => {
    describe("when called with tags", () => {
      it("includes tags in the request body", async () => {
        const { updatePrompt } = await import("../langwatch-api.js");
        mockJsonResponse({ id: "p1" });

        await updatePrompt("p1", {
          commitMessage: "tag it",
          tags: ["production"],
        });

        const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body as string);
        expect(body.tags).toEqual(["production"]);
      });
    });
  });

  describe("assignPromptTag()", () => {
    it("sends PUT to /api/prompts/{id}/tags/{tag} with versionId", async () => {
      const { assignPromptTag } = await import("../langwatch-api.js");
      mockJsonResponse({ success: true });

      await assignPromptTag({ idOrHandle: "pizza-prompt", tag: "production", versionId: "v123" });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${TEST_ENDPOINT}/api/prompts/pizza-prompt/tags/production`);
      expect(opts.method).toBe("PUT");
      expect(JSON.parse(opts.body as string)).toEqual({ versionId: "v123" });
    });
  });

  describe("listPromptTags()", () => {
    it("sends GET to /api/prompts/tags", async () => {
      const { listPromptTags } = await import("../langwatch-api.js");
      const tags = [{ id: "1", name: "production" }];
      mockJsonResponse(tags);

      const result = await listPromptTags();

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_ENDPOINT}/api/prompts/tags`,
        expect.objectContaining({ method: "GET" })
      );
      expect(result).toEqual(tags);
    });
  });

  describe("createPromptTag()", () => {
    it("sends POST to /api/prompts/tags with name", async () => {
      const { createPromptTag } = await import("../langwatch-api.js");
      mockJsonResponse({ id: "t1", name: "canary" });

      await createPromptTag("canary");

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${TEST_ENDPOINT}/api/prompts/tags`);
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body as string)).toEqual({ name: "canary" });
    });
  });

  describe("renamePromptTag()", () => {
    it("sends PUT to /api/prompts/tags/{tag} with new name", async () => {
      const { renamePromptTag } = await import("../langwatch-api.js");
      mockJsonResponse({ id: "t1", name: "preview" });

      await renamePromptTag({ tag: "canary", name: "preview" });

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${TEST_ENDPOINT}/api/prompts/tags/canary`);
      expect(opts.method).toBe("PUT");
      expect(JSON.parse(opts.body as string)).toEqual({ name: "preview" });
    });
  });

  describe("deletePromptTag()", () => {
    it("sends DELETE to /api/prompts/tags/{tag}", async () => {
      const { deletePromptTag } = await import("../langwatch-api.js");
      mock204Response();

      const result = await deletePromptTag("canary");

      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(`${TEST_ENDPOINT}/api/prompts/tags/canary`);
      expect(opts.method).toBe("DELETE");
      expect(result).toBeNull();
    });
  });

  describe("makeRequest()", () => {
    describe("when response is 204 No Content", () => {
      it("returns null without calling json()", async () => {
        const { listPromptTags } = await import("../langwatch-api.js");
        mock204Response();

        const result = await listPromptTags();
        expect(result).toBeNull();
      });
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
