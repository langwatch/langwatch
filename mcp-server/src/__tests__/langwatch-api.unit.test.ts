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

  describe("when the API returns a handled-error JSON body", () => {
    const handledErrorBody = {
      error: "invalid_filter",
      message: "Filter 'llm.model' is not supported",
      tips: ["Use 'metadata.model' instead", "See the filter reference"],
      docsUrl: "https://docs.langwatch.ai/api/filters",
      fault: "customer",
    };

    it("parses code, tips, docsUrl and fault into LangWatchApiError fields", async () => {
      const { searchTraces, LangWatchApiError } = await import(
        "../langwatch-api.js"
      );
      mockErrorResponse(400, JSON.stringify(handledErrorBody));

      const error = await searchTraces({
        startDate: 1000,
        endDate: 2000,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(LangWatchApiError);
      expect(error.status).toBe(400);
      expect(error.responseBody).toBe(JSON.stringify(handledErrorBody));
      expect(error.code).toBe("invalid_filter");
      expect(error.tips).toEqual(handledErrorBody.tips);
      expect(error.docsUrl).toBe(handledErrorBody.docsUrl);
      expect(error.fault).toBe("customer");
    });

    it("formats the message with the server message, Tips section and Docs link", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      mockErrorResponse(400, JSON.stringify(handledErrorBody));

      const error = await searchTraces({
        startDate: 1000,
        endDate: 2000,
      }).catch((e) => e);

      expect(error.message).toContain(
        "LangWatch API error 400: Filter 'llm.model' is not supported"
      );
      expect(error.message).toContain("Tips:");
      expect(error.message).toContain("- Use 'metadata.model' instead");
      expect(error.message).toContain("- See the filter reference");
      expect(error.message).toContain(
        "Docs: https://docs.langwatch.ai/api/filters"
      );
    });

    // A validation failure names the offending field AND the values it would
    // have taken, in `reasons[].meta`. Dropping that leaves the message's own
    // advice ("pick one of the types in this error's expected list") naming a
    // list the caller was never given.
    describe("when the failure carries the values it would have accepted", () => {
      const rejectedTypeBody = {
        error: "validation_error",
        message:
          "Unknown evaluator type. Pick one of the types in this error's expected list and retry.",
        reasons: [
          {
            code: "schema_failure",
            kind: "schema_failure",
            meta: {
              field: "config.evaluatorType",
              expected: ["ragas/response_relevancy", "langevals/llm_boolean"],
              received: "ragas/answer_relevancy",
            },
          },
        ],
      };

      it("keeps the reasons on the error", async () => {
        const { createEvaluator } = await import(
          "../langwatch-api-evaluators.js"
        );
        mockErrorResponse(422, JSON.stringify(rejectedTypeBody));

        const error = await createEvaluator({
          name: "Relevancy",
          config: { evaluatorType: "ragas/answer_relevancy" },
        }).catch((e) => e);

        expect(error.reasons).toEqual(rejectedTypeBody.reasons);
      });

      it("names the rejected field and the accepted values in the message", async () => {
        const { createEvaluator } = await import(
          "../langwatch-api-evaluators.js"
        );
        mockErrorResponse(422, JSON.stringify(rejectedTypeBody));

        const error = await createEvaluator({
          name: "Relevancy",
          config: { evaluatorType: "ragas/answer_relevancy" },
        }).catch((e) => e);

        expect(error.message).toContain("config.evaluatorType");
        expect(error.message).toContain("ragas/response_relevancy");
        expect(error.message).toContain("langevals/llm_boolean");
        expect(error.message).toContain("ragas/answer_relevancy");
      });
    });

    it("parses the tRPC shape using `code` instead of `error`", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      const body = {
        code: "dataset_not_found",
        message: "Dataset 'abc' not found",
        meta: { datasetId: "abc" },
        httpStatus: 404,
        fault: "customer",
        tips: ["Check the dataset slug"],
        docsUrl: "https://docs.langwatch.ai/datasets",
        reasons: [],
      };
      mockErrorResponse(404, JSON.stringify(body));

      const error = await searchTraces({
        startDate: 1000,
        endDate: 2000,
      }).catch((e) => e);

      expect(error.code).toBe("dataset_not_found");
      expect(error.tips).toEqual(["Check the dataset slug"]);
      expect(error.docsUrl).toBe("https://docs.langwatch.ai/datasets");
      expect(error.fault).toBe("customer");
      expect(error.message).toContain("Dataset 'abc' not found");
    });

    it("omits the Tips and Docs sections when absent", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      mockErrorResponse(
        401,
        JSON.stringify({ error: "unauthorized", message: "Invalid API key" })
      );

      const error = await searchTraces({
        startDate: 1000,
        endDate: 2000,
      }).catch((e) => e);

      expect(error.code).toBe("unauthorized");
      expect(error.tips).toBeUndefined();
      expect(error.docsUrl).toBeUndefined();
      expect(error.fault).toBeUndefined();
      expect(error.message).toBe(
        "LangWatch API error 401: Invalid API key"
      );
    });

    it("ignores an invalid fault value", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      mockErrorResponse(
        500,
        JSON.stringify({ error: "boom", message: "Boom", fault: "nobody" })
      );

      const error = await searchTraces({
        startDate: 1000,
        endDate: 2000,
      }).catch((e) => e);

      expect(error.fault).toBeUndefined();
    });
  });

  describe("when the error body is not a handled-error envelope", () => {
    it("keeps the raw text as the message and sets no extra fields", async () => {
      const { searchTraces, LangWatchApiError } = await import(
        "../langwatch-api.js"
      );
      mockErrorResponse(502, "<html>Bad Gateway</html>");

      const error = await searchTraces({
        startDate: 1000,
        endDate: 2000,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(LangWatchApiError);
      expect(error.status).toBe(502);
      expect(error.responseBody).toBe("<html>Bad Gateway</html>");
      expect(error.message).toBe(
        "LangWatch API error 502: <html>Bad Gateway</html>"
      );
      expect(error.code).toBeUndefined();
      expect(error.tips).toBeUndefined();
      expect(error.docsUrl).toBeUndefined();
      expect(error.fault).toBeUndefined();
    });

    it("treats JSON without error/code/message fields as raw text", async () => {
      const { searchTraces } = await import("../langwatch-api.js");
      const body = JSON.stringify({ unexpected: true });
      mockErrorResponse(500, body);

      const error = await searchTraces({
        startDate: 1000,
        endDate: 2000,
      }).catch((e) => e);

      expect(error.code).toBeUndefined();
      expect(error.message).toBe(`LangWatch API error 500: ${body}`);
    });
  });
});
