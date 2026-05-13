/**
 * E2E test: drives the real Hono /api/langy/chat route with a
 * MockLanguageModelV3 that calls a tool whose downstream service returns
 * a malformed payload. Asserts the validated `tool_output_invalid`
 * envelope is what the model receives back as the tool result on its
 * second turn — i.e. the malformed payload never reaches the model.
 *
 * Named `.e2e.test.ts` for clarity (the test drives the full request
 * pipeline through Hono), but it runs under the regular `pnpm test:unit`
 * runner because no real services are involved — all downstream
 * services and external clients are mocked at the import boundary.
 */
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DoStreamFactory = (...args: any[]) => Promise<{ stream: ReadableStream<any> }>;
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must precede the route import.
// ---------------------------------------------------------------------------

const mockGetServerAuthSession = vi.fn();
const mockHasProjectPermission = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetVercelAIModel = vi.fn();
const mockEnsureConversation = vi.fn();
const mockTouchConversation = vi.fn();
const mockGetProjectMemory = vi.fn();
const mockGetUserPrefs = vi.fn();
const mockAppendMessage = vi.fn();
const mockFeatureFlagIsEnabled = vi.fn();
const mockStreamLangyMastraResponse = vi.fn();
const mockEsSearch = vi.fn();

// Service mocks (post-PR-4.1: tools go through service layer, not raw prisma)
const mockEvaluatorGetAllWithFields = vi.fn();
const mockEvaluatorGetBySlug = vi.fn();
const mockEvaluatorEnrichWithFields = vi.fn();
const mockExperimentFindBySlug = vi.fn();
const mockDatasetListAllNonArchivedWithCounts = vi.fn();
const mockDatasetFindByIdNonArchivedWithCounts = vi.fn();
const mockDatasetListRecordsSample = vi.fn();
const mockBatchEvaluationGetRecentByExperiment = vi.fn();
const mockProjectGetById = vi.fn();
const mockPromptServiceGetAllPrompts = vi.fn();
const mockPromptServiceGetPromptByIdOrHandle = vi.fn();
const mockPromptServiceSearchByKeyword = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: (...args: unknown[]) =>
    mockGetServerAuthSession(...args),
}));

vi.mock("~/server/api/rbac", () => ({
  hasProjectPermission: (...args: unknown[]) =>
    mockHasProjectPermission(...args),
}));

vi.mock("~/server/middleware/rate-limit-langy", () => ({
  LANGY_TOOL_CALLS_PER_MESSAGE: 5,
  checkLangyMessageRateLimit: (...args: unknown[]) =>
    mockCheckRateLimit(...args),
}));

vi.mock("~/server/modelProviders/utils", () => ({
  getVercelAIModel: (...args: unknown[]) => mockGetVercelAIModel(...args),
}));

vi.mock("~/server/app-layer/clients/tokenizer/tiktoken.client", () => ({
  TiktokenClient: class {
    async countTokens(): Promise<number> {
      return 1;
    }
  },
}));

vi.mock("~/server/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn(async () => ({ search: mockEsSearch })),
  TRACE_INDEX: { alias: "trace_alias" },
}));

vi.mock("~/server/evaluators/evaluator.service", () => ({
  EvaluatorService: {
    create: () => ({
      getAllWithFields: (...args: unknown[]) =>
        mockEvaluatorGetAllWithFields(...args),
      getBySlug: (...args: unknown[]) => mockEvaluatorGetBySlug(...args),
      enrichWithFields: (...args: unknown[]) =>
        mockEvaluatorEnrichWithFields(...args),
    }),
  },
}));

vi.mock("~/server/experiments/experiment.service", () => ({
  ExperimentService: {
    create: () => ({
      findBySlug: (...args: unknown[]) => mockExperimentFindBySlug(...args),
    }),
  },
}));

vi.mock("~/server/datasets/dataset.service", () => ({
  DatasetService: {
    create: () => ({
      listAllNonArchivedWithCounts: (...args: unknown[]) =>
        mockDatasetListAllNonArchivedWithCounts(...args),
      findByIdNonArchivedWithCounts: (...args: unknown[]) =>
        mockDatasetFindByIdNonArchivedWithCounts(...args),
      listRecordsSample: (...args: unknown[]) =>
        mockDatasetListRecordsSample(...args),
    }),
  },
}));

vi.mock("~/server/evaluations/batch-evaluation.service", () => ({
  BatchEvaluationService: {
    create: () => ({
      getRecentByExperiment: (...args: unknown[]) =>
        mockBatchEvaluationGetRecentByExperiment(...args),
    }),
  },
}));

vi.mock("~/server/app-layer/projects/project.service", () => ({
  ProjectService: class {
    async getById(...args: unknown[]): Promise<unknown> {
      return mockProjectGetById(...args);
    }
  },
}));

vi.mock(
  "~/server/app-layer/projects/repositories/project.prisma.repository",
  () => ({
    PrismaProjectRepository: class {},
  }),
);

vi.mock("~/server/prompt-config/prompt.service", () => ({
  PromptService: class {
    async getAllPrompts(...args: unknown[]): Promise<unknown> {
      return mockPromptServiceGetAllPrompts(...args);
    }
    async getPromptByIdOrHandle(...args: unknown[]): Promise<unknown> {
      return mockPromptServiceGetPromptByIdOrHandle(...args);
    }
    async searchByKeyword(...args: unknown[]): Promise<unknown> {
      return mockPromptServiceSearchByKeyword(...args);
    }
  },
}));

vi.mock("~/server/db", () => ({
  prisma: {
    experiment: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => mockFeatureFlagIsEnabled(...args),
  },
}));

vi.mock("~/server/services/langy/mastra-agent", () => ({
  streamLangyMastraResponse: (...args: unknown[]) =>
    mockStreamLangyMastraResponse(...args),
}));

vi.mock("~/server/services/langy", () => ({
  LangyConversationService: {
    create: () => ({
      ensureConversation: (...args: unknown[]) =>
        mockEnsureConversation(...args),
      touch: (...args: unknown[]) => mockTouchConversation(...args),
    }),
  },
  LangyMessageService: {
    create: () => ({
      append: (...args: unknown[]) => mockAppendMessage(...args),
    }),
  },
  LangyProjectMemoryService: {
    create: () => ({
      getById: (...args: unknown[]) => mockGetProjectMemory(...args),
    }),
  },
  LangyUserPreferencesService: {
    create: () => ({
      getById: (...args: unknown[]) => mockGetUserPrefs(...args),
    }),
  },
}));

const { app } = await import("../langy");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CapturedCall {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prompt?: Array<{ role: string; content: any }>;
}

function makeToolCallingStubModel(toolName: string, input: unknown) {
  const stringifiedInput = JSON.stringify(input);
  const captures: CapturedCall[] = [];
  let turnIndex = 0;
  const turnBuilders = [
    () =>
      simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "rsp-1", modelId: "mock-1" },
          { type: "tool-input-start", id: "tc-1", toolName },
          { type: "tool-input-delta", id: "tc-1", delta: stringifiedInput },
          { type: "tool-input-end", id: "tc-1" },
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName,
            input: stringifiedInput,
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    () =>
      simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "response-metadata", id: "rsp-2", modelId: "mock-1" },
          { type: "text-start", id: "txt-1" },
          { type: "text-delta", id: "txt-1", delta: "ok" },
          { type: "text-end", id: "txt-1" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
  ];
  const doStream: DoStreamFactory = async (args: unknown) => {
    captures.push(args as CapturedCall);
    const builder =
      turnBuilders[turnIndex] ?? turnBuilders[turnBuilders.length - 1]!;
    turnIndex += 1;
    return { stream: builder() as never };
  };
  const model = new MockLanguageModelV3({ doStream });
  return { model, captures };
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value);
  }
  return acc;
}

function findToolResultContent(captures: CapturedCall[]): string {
  const second = captures[1];
  return second ? JSON.stringify(second.prompt ?? second) : "";
}

async function postChat(body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/langy/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Default-happy mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerAuthSession.mockResolvedValue({
    user: { id: "user_42", email: "tester@example.com" },
    expires: "2099-01-01",
  });
  mockHasProjectPermission.mockResolvedValue(true);
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockGetProjectMemory.mockResolvedValue(null);
  mockGetUserPrefs.mockResolvedValue({ mode: "non-expert" });
  mockFeatureFlagIsEnabled.mockResolvedValue(false);
  mockStreamLangyMastraResponse.mockReset();
  mockEnsureConversation.mockResolvedValue({ id: "conv_test_abc" });
  mockTouchConversation.mockResolvedValue(undefined);
  mockAppendMessage.mockResolvedValue(undefined);
  mockEvaluatorGetAllWithFields.mockResolvedValue([]);
  mockEvaluatorGetBySlug.mockResolvedValue(null);
  mockEvaluatorEnrichWithFields.mockResolvedValue({});
  mockExperimentFindBySlug.mockResolvedValue(null);
  mockDatasetListAllNonArchivedWithCounts.mockResolvedValue([]);
  mockDatasetFindByIdNonArchivedWithCounts.mockResolvedValue(null);
  mockDatasetListRecordsSample.mockResolvedValue([]);
  mockBatchEvaluationGetRecentByExperiment.mockResolvedValue([]);
  mockProjectGetById.mockResolvedValue(null);
  mockPromptServiceGetAllPrompts.mockResolvedValue([]);
  mockPromptServiceGetPromptByIdOrHandle.mockResolvedValue(null);
  mockPromptServiceSearchByKeyword.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

describe("POST /api/langy/chat — runtime tool-output validation E2E", () => {
  describe("when search_traces' elasticsearch downstream returns hits with non-string _id", () => {
    it("hands the model a tool_output_invalid envelope, never the malformed payload", async () => {
      mockEsSearch.mockResolvedValueOnce({
        hits: { hits: [{ _id: 99999, _source: {} }] },
      });
      const { model, captures } = makeToolCallingStubModel("search_traces", {
        query: "hallucinations",
        limit: 5,
      });
      mockGetVercelAIModel.mockResolvedValue(model);

      const res = await postChat({
        projectId: "proj_demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "find traces about hallucinations" }],
          },
        ],
      });
      await readBody(res);

      expect(res.status).toBe(200);
      expect(captures.length).toBeGreaterThanOrEqual(2);

      const secondTurnDump = findToolResultContent(captures);
      expect(secondTurnDump).toContain("tool_output_invalid");
      expect(secondTurnDump).not.toContain("99999");
    });
  });

  describe("when search_past_runs' batchEvaluationService returns a row with non-string id", () => {
    it("hands the model a tool_output_invalid envelope", async () => {
      mockBatchEvaluationGetRecentByExperiment.mockResolvedValueOnce([
        {
          id: 88888,
          experimentId: "exp-1",
          createdAt: new Date(),
          status: "complete",
          score: 1,
          passed: true,
          evaluation: "evaluation-name",
        },
      ]);
      const { model, captures } = makeToolCallingStubModel(
        "search_past_runs",
        { limit: 5 },
      );
      mockGetVercelAIModel.mockResolvedValue(model);

      const res = await postChat({
        projectId: "proj_demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "show me past runs" }],
          },
        ],
      });
      await readBody(res);

      const secondTurnDump = findToolResultContent(captures);
      expect(secondTurnDump).toContain("tool_output_invalid");
      expect(secondTurnDump).not.toContain("88888");
    });
  });

  describe("when list_datasets' datasetService returns a row with non-string id", () => {
    it("hands the model a tool_output_invalid envelope", async () => {
      mockDatasetListAllNonArchivedWithCounts.mockResolvedValueOnce([
        {
          id: 77777,
          slug: "ds-1",
          name: "Dataset 1",
          columnTypes: [],
          _count: { datasetRecords: 0 },
        },
      ]);
      const { model, captures } = makeToolCallingStubModel(
        "list_datasets",
        {},
      );
      mockGetVercelAIModel.mockResolvedValue(model);

      const res = await postChat({
        projectId: "proj_demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "list datasets" }],
          },
        ],
      });
      await readBody(res);

      const secondTurnDump = findToolResultContent(captures);
      expect(secondTurnDump).toContain("tool_output_invalid");
      expect(secondTurnDump).not.toContain("77777");
    });
  });

  describe("when list_prompts' promptService returns a row with non-string id", () => {
    it("hands the model a tool_output_invalid envelope", async () => {
      mockPromptServiceGetAllPrompts.mockResolvedValueOnce([
        {
          id: 66666,
          handle: "p-1",
          name: "Prompt 1",
          model: "openai/gpt-5-mini",
          scope: "project",
        },
      ]);
      const { model, captures } = makeToolCallingStubModel(
        "list_prompts",
        {},
      );
      mockGetVercelAIModel.mockResolvedValue(model);

      const res = await postChat({
        projectId: "proj_demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "list prompts" }],
          },
        ],
      });
      await readBody(res);

      const secondTurnDump = findToolResultContent(captures);
      expect(secondTurnDump).toContain("tool_output_invalid");
      expect(secondTurnDump).not.toContain("66666");
    });
  });

  describe("when list_evaluators' evaluatorService returns a project evaluator with non-string id", () => {
    it("hands the model a tool_output_invalid envelope", async () => {
      mockEvaluatorGetAllWithFields.mockResolvedValueOnce([
        {
          id: 55555,
          slug: "e-1",
          name: "Eval 1",
          type: "custom",
          fields: [{ identifier: "f1" }],
        },
      ]);
      const { model, captures } = makeToolCallingStubModel("list_evaluators", {
        scope: "project",
      });
      mockGetVercelAIModel.mockResolvedValue(model);

      const res = await postChat({
        projectId: "proj_demo",
        messages: [
          {
            id: "m1",
            role: "user",
            parts: [{ type: "text", text: "list evaluators" }],
          },
        ],
      });
      await readBody(res);

      const secondTurnDump = findToolResultContent(captures);
      expect(secondTurnDump).toContain("tool_output_invalid");
      expect(secondTurnDump).not.toContain("55555");
    });
  });
});
