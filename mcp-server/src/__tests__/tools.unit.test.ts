import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api.js", () => ({
  searchTraces: vi.fn(),
  getTraceById: vi.fn(),
  getAnalyticsTimeseries: vi.fn(),
  listPrompts: vi.fn(),
  getPrompt: vi.fn(),
  createPrompt: vi.fn(),
  updatePrompt: vi.fn(),
  assignPromptTag: vi.fn(),
  listPromptTags: vi.fn(),
  createPromptTag: vi.fn(),
  renamePromptTag: vi.fn(),
  deletePromptTag: vi.fn(),
}));

import {
  searchTraces,
  getTraceById,
  getAnalyticsTimeseries,
  listPrompts,
  getPrompt,
  createPrompt,
  updatePrompt,
  assignPromptTag,
  listPromptTags,
  createPromptTag,
  renamePromptTag,
  deletePromptTag,
  type PromptSummary,
} from "../langwatch-api.js";

import { handleSearchTraces } from "../tools/search-traces.js";
import { handleGetTrace } from "../tools/get-trace.js";
import { handleGetAnalytics } from "../tools/get-analytics.js";
import { handleListPrompts } from "../tools/list-prompts.js";
import { handleGetPrompt } from "../tools/get-prompt.js";
import { handleCreatePrompt } from "../tools/create-prompt.js";
import { handleUpdatePrompt } from "../tools/update-prompt.js";
import { handleAssignPromptTag } from "../tools/assign-prompt-tag.js";
import { handleListPromptTags } from "../tools/list-prompt-tags.js";
import { handleCreatePromptTag } from "../tools/create-prompt-tag.js";
import { handleRenamePromptTag } from "../tools/rename-prompt-tag.js";
import { handleDeletePromptTag } from "../tools/delete-prompt-tag.js";

const mockSearchTraces = vi.mocked(searchTraces);
const mockGetTraceById = vi.mocked(getTraceById);
const mockGetAnalytics = vi.mocked(getAnalyticsTimeseries);
const mockListPrompts = vi.mocked(listPrompts);
const mockGetPrompt = vi.mocked(getPrompt);
const mockCreatePrompt = vi.mocked(createPrompt);
const mockUpdatePrompt = vi.mocked(updatePrompt);
const mockAssignPromptTag = vi.mocked(assignPromptTag);
const mockListPromptTags = vi.mocked(listPromptTags);
const mockCreatePromptTag = vi.mocked(createPromptTag);
const mockRenamePromptTag = vi.mocked(renamePromptTag);
const mockDeletePromptTag = vi.mocked(deletePromptTag);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSearchTraces()", () => {
  describe("when traces are found with formatted_trace (digest mode)", () => {
    it("shows formatted digest per trace", async () => {
      mockSearchTraces.mockResolvedValue({
        traces: [
          {
            trace_id: "trace-1",
            formatted_trace: "LLM Call [llm] 500ms\n  Input: Hello\n  Output: Hi",
            input: { value: "Hello world" },
            output: { value: "Hi there" },
            timestamps: { started_at: "2024-01-01T00:00:00Z" },
          },
        ],
        pagination: { totalHits: 1 },
      });

      const result = await handleSearchTraces({});

      expect(result).toContain("Found 1 traces:");
      expect(result).toContain("### Trace: trace-1");
      expect(result).toContain("LLM Call [llm] 500ms");
      expect(result).toContain("**Time**: 2024-01-01T00:00:00Z");
    });
  });

  describe("when traces have no formatted_trace", () => {
    it("falls back to input/output truncation", async () => {
      mockSearchTraces.mockResolvedValue({
        traces: [
          {
            trace_id: "trace-2",
            input: { value: "Hello world" },
            output: { value: "Hi there" },
          },
        ],
        pagination: { totalHits: 1 },
      });

      const result = await handleSearchTraces({});

      expect(result).toContain("**Input**: Hello world");
      expect(result).toContain("**Output**: Hi there");
    });

    it("truncates long input/output to 100 characters", async () => {
      const longText = "x".repeat(150);
      mockSearchTraces.mockResolvedValue({
        traces: [
          {
            trace_id: "trace-2",
            input: { value: longText },
            output: { value: longText },
          },
        ],
        pagination: { totalHits: 1 },
      });

      const result = await handleSearchTraces({});

      expect(result).toContain("x".repeat(100) + "...");
    });
  });

  describe("when format is json", () => {
    it("returns raw JSON string", async () => {
      const responseData = {
        traces: [{ trace_id: "trace-1", input: { value: "Hello" } }],
        pagination: { totalHits: 1 },
      };
      mockSearchTraces.mockResolvedValue(responseData);

      const result = await handleSearchTraces({ format: "json" });

      expect(JSON.parse(result)).toEqual(responseData);
    });
  });

  it("includes scroll ID when more results are available", async () => {
    mockSearchTraces.mockResolvedValue({
      traces: [{ trace_id: "trace-1", input: { value: "" }, output: { value: "" } }],
      pagination: { totalHits: 100, scrollId: "scroll-abc" },
    });

    const result = await handleSearchTraces({});

    expect(result).toContain('scrollId: "scroll-abc"');
  });

  it("shows error information when trace has errors", async () => {
    mockSearchTraces.mockResolvedValue({
      traces: [
        {
          trace_id: "trace-err",
          input: { value: "" },
          output: { value: "" },
          error: { message: "timeout" },
        },
      ],
      pagination: { totalHits: 1 },
    });

    const result = await handleSearchTraces({});

    expect(result).toContain("**Error**");
    expect(result).toContain("timeout");
  });

  describe("when no traces are found", () => {
    it("returns a no-results message", async () => {
      mockSearchTraces.mockResolvedValue({ traces: [] });

      const result = await handleSearchTraces({});

      expect(result).toBe("No traces found matching your query.");
    });
  });

  describe("when relative dates are provided", () => {
    it("passes parsed timestamps to the API", async () => {
      mockSearchTraces.mockResolvedValue({ traces: [] });

      await handleSearchTraces({ startDate: "7d", endDate: "1d" });

      const call = mockSearchTraces.mock.calls[0]![0] as any;
      expect(call.startDate).toBeTypeOf("number");
      expect(call.endDate).toBeTypeOf("number");
      expect(call.startDate).toBeLessThan(call.endDate);
    });
  });

  describe("when pageSize is specified", () => {
    it("passes pageSize to the API", async () => {
      mockSearchTraces.mockResolvedValue({ traces: [] });

      await handleSearchTraces({ pageSize: 50 });

      const call = mockSearchTraces.mock.calls[0]![0] as any;
      expect(call.pageSize).toBe(50);
    });
  });

  describe("when pageSize is not specified", () => {
    it("defaults to 25", async () => {
      mockSearchTraces.mockResolvedValue({ traces: [] });

      await handleSearchTraces({});

      const call = mockSearchTraces.mock.calls[0]![0] as any;
      expect(call.pageSize).toBe(25);
    });
  });

  it("passes format to the API", async () => {
    mockSearchTraces.mockResolvedValue({ traces: [] });

    await handleSearchTraces({ format: "json" });

    const call = mockSearchTraces.mock.calls[0]![0] as any;
    expect(call.format).toBe("json");
  });

  it("defaults format to digest", async () => {
    mockSearchTraces.mockResolvedValue({ traces: [] });

    await handleSearchTraces({});

    const call = mockSearchTraces.mock.calls[0]![0] as any;
    expect(call.format).toBe("digest");
  });

  it("includes usage tip about get_trace, format, and discover_schema", async () => {
    mockSearchTraces.mockResolvedValue({
      traces: [{ trace_id: "t1", input: { value: "" }, output: { value: "" } }],
      pagination: { totalHits: 1 },
    });

    const result = await handleSearchTraces({});

    expect(result).toContain("get_trace");
    expect(result).toContain("discover_schema");
    expect(result).toContain('"json"');
  });
});

describe("handleGetTrace()", () => {
  describe("when trace has formatted_trace (digest mode)", () => {
    it("shows the formatted digest", async () => {
      mockGetTraceById.mockResolvedValue({
        trace_id: "trace-abc",
        formatted_trace: "Root [server] 1200ms\n  LLM Call [llm] 800ms\n    Input: Hello\n    Output: Hi there",
        timestamps: {
          started_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:01:00Z",
        },
        metadata: { user_id: "user-123" },
        evaluations: [
          { name: "Toxicity", passed: true, score: 0.95 },
        ],
      });

      const result = await handleGetTrace({ traceId: "trace-abc" });

      expect(result).toContain("# Trace: trace-abc");
      expect(result).toContain("**Started**: 2024-01-01T00:00:00Z");
      expect(result).toContain("**User**: user-123");
      expect(result).toContain("## Evaluations");
      expect(result).toContain("**Toxicity**: PASSED (score: 0.95)");
      expect(result).toContain("## Trace Details");
      expect(result).toContain("Root [server] 1200ms");
      expect(result).toContain("LLM Call [llm] 800ms");
    });

    it("includes tip about json format", async () => {
      mockGetTraceById.mockResolvedValue({
        trace_id: "trace-abc",
        formatted_trace: "some digest",
      });

      const result = await handleGetTrace({ traceId: "trace-abc" });

      expect(result).toContain('"json"');
      expect(result).toContain("get_trace");
    });
  });

  describe("when format is json", () => {
    it("returns raw JSON string", async () => {
      const responseData = {
        trace_id: "trace-abc",
        spans: [{ span_id: "s1", name: "LLM Call" }],
        evaluations: [],
        metadata: {},
      };
      mockGetTraceById.mockResolvedValue(responseData);

      const result = await handleGetTrace({ traceId: "trace-abc", format: "json" });

      expect(JSON.parse(result)).toEqual(responseData);
    });

    it("passes json format to the API", async () => {
      mockGetTraceById.mockResolvedValue({ trace_id: "trace-abc" });

      await handleGetTrace({ traceId: "trace-abc", format: "json" });

      expect(mockGetTraceById).toHaveBeenCalledWith("trace-abc", "json");
    });
  });

  describe("when trace has metadata fields", () => {
    it("formats metadata fields", async () => {
      mockGetTraceById.mockResolvedValue({
        trace_id: "trace-abc",
        metadata: {
          user_id: "user-123",
          thread_id: "thread-456",
          customer_id: "cust-789",
          labels: ["production", "important"],
        },
      });

      const result = await handleGetTrace({ traceId: "trace-abc" });

      expect(result).toContain("**User**: user-123");
      expect(result).toContain("**Thread**: thread-456");
      expect(result).toContain("**Customer**: cust-789");
      expect(result).toContain("**Labels**: production, important");
    });
  });

  describe("when trace has evaluations", () => {
    it("formats evaluations", async () => {
      mockGetTraceById.mockResolvedValue({
        trace_id: "trace-abc",
        evaluations: [
          { name: "Toxicity", passed: true, score: 0.95 },
          { evaluator_id: "eval-2", passed: false, label: "bad" },
        ],
      });

      const result = await handleGetTrace({ traceId: "trace-abc" });

      expect(result).toContain("## Evaluations");
      expect(result).toContain("**Toxicity**: PASSED (score: 0.95)");
      expect(result).toContain("**eval-2**: FAILED");
      expect(result).toContain("[bad]");
    });
  });

  describe("when trace has no formatted_trace", () => {
    it("still renders header and metadata", async () => {
      mockGetTraceById.mockResolvedValue({
        trace_id: "trace-abc",
        timestamps: { started_at: "2024-01-01" },
      });

      const result = await handleGetTrace({ traceId: "trace-abc" });

      expect(result).toContain("# Trace: trace-abc");
      expect(result).toContain("**Started**: 2024-01-01");
      expect(result).not.toContain("## Trace Details");
    });
  });

  describe("when digest format is used (default)", () => {
    it("passes digest format to the API", async () => {
      mockGetTraceById.mockResolvedValue({ trace_id: "trace-abc" });

      await handleGetTrace({ traceId: "trace-abc" });

      expect(mockGetTraceById).toHaveBeenCalledWith("trace-abc", "digest");
    });
  });
});

describe("handleGetAnalytics()", () => {
  describe("when data is available", () => {
    it("formats a markdown table with date and value", async () => {
      mockGetAnalytics.mockResolvedValue({
        currentPeriod: [
          { date: "2024-01-01", metric_0: 42 },
          { date: "2024-01-02", metric_0: 55 },
        ],
        previousPeriod: [],
      });

      const result = await handleGetAnalytics({
        metric: "performance.completion_time",
      });

      expect(result).toContain(
        "# Analytics: performance.completion_time (avg)"
      );
      expect(result).toContain("| Date | Value |");
      expect(result).toContain("| 2024-01-01 | 42 |");
      expect(result).toContain("| 2024-01-02 | 55 |");
    });

    it("shows groupBy when provided", async () => {
      mockGetAnalytics.mockResolvedValue({ currentPeriod: [], previousPeriod: [] });

      const result = await handleGetAnalytics({
        metric: "metadata.trace_id",
        groupBy: "metadata.model",
      });

      expect(result).toContain("Grouped by: metadata.model");
    });

    it("uses the specified aggregation", async () => {
      mockGetAnalytics.mockResolvedValue({ currentPeriod: [], previousPeriod: [] });

      const result = await handleGetAnalytics({
        metric: "performance.total_cost",
        aggregation: "sum",
      });

      expect(result).toContain("(sum)");
      const call = mockGetAnalytics.mock.calls[0]![0] as any;
      expect(call.series[0].aggregation).toBe("sum");
    });
  });

  describe("when no data is available", () => {
    it("returns a no-data message", async () => {
      mockGetAnalytics.mockResolvedValue({ currentPeriod: [], previousPeriod: [] });

      const result = await handleGetAnalytics({
        metric: "performance.completion_time",
      });

      expect(result).toContain("No data available for this period.");
    });
  });

  describe("when metric has no dot", () => {
    it("defaults category to metadata", async () => {
      mockGetAnalytics.mockResolvedValue({ currentPeriod: [], previousPeriod: [] });

      await handleGetAnalytics({ metric: "trace_id" });

      const call = mockGetAnalytics.mock.calls[0]![0] as any;
      expect(call.series[0].metric).toBe("metadata.trace_id");
    });
  });

  it("includes discover_schema tip", async () => {
    mockGetAnalytics.mockResolvedValue({ currentPeriod: [], previousPeriod: [] });

    const result = await handleGetAnalytics({
      metric: "performance.completion_time",
    });

    expect(result).toContain("discover_schema");
  });
});

describe("handleListPrompts()", () => {
  describe("when prompts exist", () => {
    it("formats a markdown table with prompt details", async () => {
      mockListPrompts.mockResolvedValue([
        {
          handle: "greeting",
          name: "Greeting Prompt",
          latestVersionNumber: 3,
        },
        {
          id: "p2",
          name: "Summary",
          version: 1,
        },
      ]);

      const result = await handleListPrompts();

      expect(result).toContain("# Prompts (2 total)");
      expect(result).toContain("| Handle | Name | Latest Version |");
      expect(result).toContain("| greeting | Greeting Prompt | v3 |");
      expect(result).toContain("| p2 | Summary | v1 |");
    });
  });

  describe("when no prompts exist", () => {
    it("returns a no-prompts message", async () => {
      mockListPrompts.mockResolvedValue([]);

      const result = await handleListPrompts();

      expect(result).toBe("No prompts found in this project.");
    });
  });

  describe("when API returns non-array", () => {
    it("returns a no-prompts message", async () => {
      mockListPrompts.mockResolvedValue(null as unknown as PromptSummary[]);

      const result = await handleListPrompts();

      expect(result).toBe("No prompts found in this project.");
    });
  });

  it("includes usage tip about platform_get_prompt", async () => {
    mockListPrompts.mockResolvedValue([
      { handle: "test", name: "Test", latestVersionNumber: 1 },
    ]);

    const result = await handleListPrompts();

    expect(result).toContain("platform_get_prompt");
  });
});

describe("handleGetPrompt()", () => {
  describe("when prompt has full details", () => {
    it("formats the prompt header and metadata", async () => {
      mockGetPrompt.mockResolvedValue({
        id: "p1",
        handle: "greeting",
        name: "Greeting Prompt",
        latestVersionNumber: 2,
        versions: [
          {
            version: 2,
            model: "openai/gpt-4o",
            messages: [
              { role: "system", content: "You are a greeter." },
              { role: "user", content: "Hello!" },
            ],
            commitMessage: "Updated greeting",
          },
          {
            version: 1,
            commitMessage: "Initial version",
          },
        ],
      });

      const result = await handleGetPrompt({ idOrHandle: "greeting" });

      expect(result).toContain("# Prompt: Greeting Prompt");
      expect(result).toContain("**Handle**: greeting");
      expect(result).toContain("**ID**: p1");
      expect(result).toContain("**Latest Version**: v2");
      expect(result).toContain("**Model**: openai/gpt-4o");
      expect(result).not.toContain("**Provider**");
    });

    it("formats messages", async () => {
      mockGetPrompt.mockResolvedValue({
        name: "Test",
        versions: [
          {
            messages: [
              { role: "system", content: "You are helpful." },
              { role: "user", content: "Hi there" },
            ],
          },
        ],
      });

      const result = await handleGetPrompt({ idOrHandle: "test" });

      expect(result).toContain("## Messages");
      expect(result).toContain("### system\nYou are helpful.");
      expect(result).toContain("### user\nHi there");
    });

    it("formats version history", async () => {
      mockGetPrompt.mockResolvedValue({
        name: "Test",
        versions: [
          { version: 3, commitMessage: "Third update" },
          { version: 2, commitMessage: "Second update" },
          { version: 1, commitMessage: "Initial" },
        ],
      });

      const result = await handleGetPrompt({ idOrHandle: "test" });

      expect(result).toContain("## Version History");
      expect(result).toContain("- **v3**: Third update");
      expect(result).toContain("- **v2**: Second update");
      expect(result).toContain("- **v1**: Initial");
    });
  });

  describe("when prompt has more than 10 versions", () => {
    it("truncates version history with a count", async () => {
      const versions = Array.from({ length: 12 }, (_, i) => ({
        version: 12 - i,
        commitMessage: `Version ${12 - i}`,
      }));

      mockGetPrompt.mockResolvedValue({
        name: "Test",
        versions,
      });

      const result = await handleGetPrompt({ idOrHandle: "test" });

      expect(result).toContain("... and 2 more versions");
    });
  });

  describe("when prompt has no versions", () => {
    it("uses prompt-level model config", async () => {
      mockGetPrompt.mockResolvedValue({
        name: "Simple",
        model: "openai/gpt-3.5-turbo",
        messages: [{ role: "system", content: "Be brief." }],
      });

      const result = await handleGetPrompt({ idOrHandle: "simple" });

      expect(result).toContain("**Model**: openai/gpt-3.5-turbo");
      expect(result).not.toContain("**Provider**");
      expect(result).toContain("### system\nBe brief.");
    });
  });
});

describe("handleCreatePrompt()", () => {
  describe("when prompt is created successfully", () => {
    it("formats a success message with details", async () => {
      mockCreatePrompt.mockResolvedValue({
        id: "new-id-123",
        handle: "my-prompt",
        name: "My Prompt",
        latestVersionNumber: 1,
      });

      const result = await handleCreatePrompt({
        name: "My Prompt",
        handle: "my-prompt",
        messages: [{ role: "system", content: "You are helpful." }],
        model: "openai/gpt-4o",
      });

      expect(result).toContain("Prompt created successfully!");
      expect(result).toContain("**ID**: new-id-123");
      expect(result).toContain("**Handle**: my-prompt");
      expect(result).toContain("**Name**: My Prompt");
      expect(result).toContain("**Model**: openai/gpt-4o");
      expect(result).toContain("**Version**: v1");
    });

    it("generates handle from name when handle is not provided", async () => {
      mockCreatePrompt.mockResolvedValue({
        id: "new-id",
        handle: "my-prompt",
      });

      await handleCreatePrompt({
        name: "My Prompt!",
        messages: [{ role: "system", content: "test" }],
        model: "openai/gpt-4o",
      });

      expect(mockCreatePrompt).toHaveBeenCalledWith({
        handle: "my-prompt",
        messages: [{ role: "system", content: "test" }],
        model: "openai/gpt-4o",
      });
    });

    it("uses provided handle instead of generating one", async () => {
      mockCreatePrompt.mockResolvedValue({
        id: "new-id",
        handle: "custom-handle",
      });

      await handleCreatePrompt({
        name: "My Prompt",
        handle: "custom-handle",
        messages: [{ role: "system", content: "test" }],
        model: "openai/gpt-4o",
      });

      expect(mockCreatePrompt).toHaveBeenCalledWith({
        handle: "custom-handle",
        messages: [{ role: "system", content: "test" }],
        model: "openai/gpt-4o",
      });
    });
  });

  describe("when API returns no name", () => {
    it("uses the input name as fallback", async () => {
      mockCreatePrompt.mockResolvedValue({ id: "p1" });

      const result = await handleCreatePrompt({
        name: "Fallback Name",
        messages: [{ role: "system", content: "test" }],
        model: "openai/gpt-4o",
      });

      expect(result).toContain("**Name**: Fallback Name");
    });
  });
});

describe("handleUpdatePrompt()", () => {
  describe("when updating a prompt", () => {
    it("formats an update success message", async () => {
      mockUpdatePrompt.mockResolvedValue({
        id: "p1",
        handle: "greeting",
        latestVersionNumber: 2,
      });

      const result = await handleUpdatePrompt({
        idOrHandle: "greeting",
        messages: [{ role: "system", content: "Updated content" }],
        commitMessage: "Update system prompt",
      });

      expect(result).toContain("Prompt updated successfully!");
      expect(result).toContain("**ID**: p1");
      expect(result).toContain("**Handle**: greeting");
      expect(result).toContain("**Version**: v2");
      expect(result).toContain("**Commit**: Update system prompt");
    });

    it("calls updatePrompt API with correct params", async () => {
      mockUpdatePrompt.mockResolvedValue({});

      await handleUpdatePrompt({
        idOrHandle: "greeting",
        model: "openai/gpt-4o",
        commitMessage: "Switch model",
      });

      expect(mockUpdatePrompt).toHaveBeenCalledWith("greeting", {
        model: "openai/gpt-4o",
        commitMessage: "Switch model",
      });
    });
  });
});

describe("handleGetPrompt() with tag options", () => {
  describe("when called with a tag", () => {
    it("passes tag option to the API", async () => {
      mockGetPrompt.mockResolvedValue({ name: "Test" });

      await handleGetPrompt({ idOrHandle: "pizza-prompt", tag: "production" });

      expect(mockGetPrompt).toHaveBeenCalledWith("pizza-prompt", { version: undefined, tag: "production" });
    });
  });
});

describe("handleCreatePrompt() with tags", () => {
  describe("when called with tags", () => {
    it("includes tags in the output", async () => {
      mockCreatePrompt.mockResolvedValue({ id: "p1", handle: "test" });

      const result = await handleCreatePrompt({
        name: "Test",
        messages: [{ role: "system", content: "hi" }],
        model: "openai/gpt-5-mini",
        tags: ["production"],
      });

      expect(result).toContain("**Tags**: production");
    });
  });
});

describe("handleUpdatePrompt() with tags", () => {
  describe("when called with tags", () => {
    it("includes tags in the output", async () => {
      mockUpdatePrompt.mockResolvedValue({ id: "p1", handle: "test", latestVersionNumber: 2 });

      const result = await handleUpdatePrompt({
        idOrHandle: "test",
        commitMessage: "add tags",
        tags: ["staging"],
      });

      expect(result).toContain("**Tags**: staging");
    });
  });
});

describe("handleAssignPromptTag()", () => {
  describe("when tag is assigned successfully", () => {
    it("returns a confirmation with prompt, tag, and version", async () => {
      mockAssignPromptTag.mockResolvedValue({ success: true });

      const result = await handleAssignPromptTag({
        idOrHandle: "pizza-prompt",
        tag: "production",
        versionId: "v123",
      });

      expect(result).toContain("Tag assigned successfully!");
      expect(result).toContain("**Prompt**: pizza-prompt");
      expect(result).toContain("**Tag**: production");
      expect(result).toContain("**Version ID**: v123");
    });
  });
});

describe("handleListPromptTags()", () => {
  describe("when tags exist", () => {
    it("formats tags as a markdown list", async () => {
      mockListPromptTags.mockResolvedValue([
        { id: "1", name: "production", createdAt: "2024-01-01" },
        { id: "2", name: "staging" },
      ]);

      const result = await handleListPromptTags();

      expect(result).toContain("# Prompt Tags");
      expect(result).toContain("**production**");
      expect(result).toContain("**staging**");
    });
  });

  describe("when no tags exist", () => {
    it("returns an empty-state message mentioning latest", async () => {
      mockListPromptTags.mockResolvedValue([]);

      const result = await handleListPromptTags();

      expect(result).toContain("No prompt tags found");
      expect(result).toContain("`latest`");
    });
  });
});

describe("handleCreatePromptTag()", () => {
  describe("when tag is created successfully", () => {
    it("returns a confirmation with the tag name", async () => {
      mockCreatePromptTag.mockResolvedValue({ id: "t1", name: "canary" });

      const result = await handleCreatePromptTag({ name: "canary" });

      expect(result).toContain("Tag created successfully!");
      expect(result).toContain("**Name**: canary");
    });
  });
});

describe("handleRenamePromptTag()", () => {
  describe("when tag is renamed successfully", () => {
    it("returns a confirmation with old and new names", async () => {
      mockRenamePromptTag.mockResolvedValue({ id: "t1", name: "preview" });

      const result = await handleRenamePromptTag({ tag: "canary", name: "preview" });

      expect(result).toContain("Tag renamed successfully!");
      expect(result).toContain("**Old name**: canary");
      expect(result).toContain("**New name**: preview");
    });
  });
});

describe("handleDeletePromptTag()", () => {
  describe("when tag is deleted successfully", () => {
    it("returns a confirmation with the tag name", async () => {
      mockDeletePromptTag.mockResolvedValue(null);

      const result = await handleDeletePromptTag({ tag: "canary" });

      expect(result).toContain("Tag deleted successfully!");
      expect(result).toContain("**Tag**: canary");
    });
  });
});
