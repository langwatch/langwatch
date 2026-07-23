import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import chalk from "chalk";
import type { EvaluatorResponse } from "@/client-sdk/services/evaluators";
import { EvaluatorsApiError } from "@/client-sdk/services/evaluators";

// Mock dependencies before imports
vi.mock("@/client-sdk/services/evaluators", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@/client-sdk/services/evaluators")>();
  return {
    ...actual,
    EvaluatorsApiService: vi.fn(),
  };
});

vi.mock("../../../utils/apiKey", () => ({
  checkApiKey: vi.fn(),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { EvaluatorsApiService } from "@/client-sdk/services/evaluators";
import { listEvaluatorsCommand } from "../list";
import { getEvaluatorCommand } from "../get";
import { createEvaluatorCommand } from "../create";
import { deleteEvaluatorCommand } from "../delete";
import { applyOutputContext, resolveOutputOptions } from "../../../utils/output";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty — suppresses output during tests
};

const mockProcessExit = () => {
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
};

const makeEvaluator = (overrides: Partial<EvaluatorResponse> = {}): EvaluatorResponse => ({
  id: "evaluator_abc123",
  projectId: "proj_1",
  name: "Test Evaluator",
  slug: "test-evaluator",
  type: "evaluator",
  config: { evaluatorType: "langevals/llm_boolean" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  fields: [{ identifier: "input", type: "string" }],
  outputFields: [{ identifier: "score", type: "number" }],
  platformUrl: "https://app.langwatch.ai/proj-1/evaluators/evaluator_abc123",
  ...overrides,
});

describe("listEvaluatorsCommand()", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAll = vi.fn();
    vi.mocked(EvaluatorsApiService).mockImplementation(function () { return ({
      getAll: mockGetAll,
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    }) as unknown as EvaluatorsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when evaluators exist", () => {
    it("calls getAll and prints output", async () => {
      mockGetAll.mockResolvedValue([makeEvaluator()]);

      await listEvaluatorsCommand();

      expect(mockGetAll).toHaveBeenCalledOnce();
    });
  });

  describe("when no evaluators exist", () => {
    it("prints empty-state guidance", async () => {
      mockGetAll.mockResolvedValue([]);

      await listEvaluatorsCommand();

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe("when the API call fails", () => {
    it("exits with code 1", async () => {
      mockGetAll.mockRejectedValue(
        new EvaluatorsApiError("Network error", "fetch all evaluators"),
      );

      await expect(listEvaluatorsCommand()).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("getEvaluatorCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    vi.mocked(EvaluatorsApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: mockGet,
      create: vi.fn(),
      delete: vi.fn(),
    }) as unknown as EvaluatorsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when evaluator is found", () => {
    it("calls get with the provided slug", async () => {
      mockGet.mockResolvedValue(makeEvaluator());

      await getEvaluatorCommand("test-evaluator");

      expect(mockGet).toHaveBeenCalledWith("test-evaluator");
    });
  });

  describe("when evaluator is not found", () => {
    it("exits with code 1", async () => {
      mockGet.mockRejectedValue(
        new EvaluatorsApiError("Not found", "fetch evaluator"),
      );

      await expect(getEvaluatorCommand("nonexistent")).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createEvaluatorCommand()", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate = vi.fn();
    vi.mocked(EvaluatorsApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: mockCreate,
      delete: vi.fn(),
    }) as unknown as EvaluatorsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when creation succeeds", () => {
    it("calls create with name and evaluatorType config", async () => {
      mockCreate.mockResolvedValue(makeEvaluator({ name: "My Eval" }));

      await createEvaluatorCommand("My Eval", { type: "langevals/llm_boolean" });

      expect(mockCreate).toHaveBeenCalledWith({
        name: "My Eval",
        config: { evaluatorType: "langevals/llm_boolean" },
      });
    });

    /** @scenario The CLI accepts every type the platform's catalog accepts */
    it("accepts the platform's native evaluator types, not only the langevals catalog", async () => {
      mockCreate.mockResolvedValue(makeEvaluator({ name: "Secrets" }));

      await createEvaluatorCommand("Secrets", {
        type: "langwatch/api_keys_and_secrets_detection",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        name: "Secrets",
        config: { evaluatorType: "langwatch/api_keys_and_secrets_detection" },
      });
    });
  });

  describe("when the evaluator type is not in the catalog", () => {
    // The live failure this pins: an agent sent a stale slug
    // ("ragas/answer_relevancy") and only learned it was wrong after a
    // network round-trip, from a 422 that named no valid alternatives.
    /** @scenario The CLI rejects an unknown evaluator type before calling the API */
    it("fails before any API call is made", async () => {
      await expect(
        createEvaluatorCommand("quick-relevancy", {
          type: "ragas/answer_relevancy",
        }),
      ).rejects.toThrow(ProcessExitError);

      expect(mockCreate).not.toHaveBeenCalled();
    });

    /** @scenario The CLI rejects an unknown evaluator type before calling the API */
    it("names the closest valid slugs and the command that lists them all", async () => {
      await expect(
        createEvaluatorCommand("quick-relevancy", {
          type: "ragas/answer_relevancy",
        }),
      ).rejects.toThrow(ProcessExitError);

      const printed = vi
        .mocked(console.error)
        .mock.calls.map((call) => String(call[0]))
        .join("\n");
      expect(printed).toContain("ragas/response_relevancy");
      expect(printed).toContain("langwatch evaluator types");
    });
  });

  describe("when creation fails", () => {
    it("exits with code 1", async () => {
      mockCreate.mockRejectedValue(
        new EvaluatorsApiError("Limit reached", "create evaluator"),
      );

      await expect(
        createEvaluatorCommand("My Eval", { type: "langevals/llm_boolean" }),
      ).rejects.toThrow(ProcessExitError);
    });
  });
});

describe("createEvaluatorCommand() catalog-miss shape under machine formats", () => {
  let savedChalkLevel: typeof chalk.level;

  beforeEach(() => {
    vi.clearAllMocks();
    savedChalkLevel = chalk.level;
    vi.mocked(EvaluatorsApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    }) as unknown as EvaluatorsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  afterEach(async () => {
    chalk.level = savedChalkLevel;
    await applyOutputContext(resolveOutputOptions({}, {}));
  });

  it("emits validation_error with the reason's expected/received, the shape rule 16 reads", async () => {
    await applyOutputContext(resolveOutputOptions({ output: "json", format: "table" }, {}));

    await expect(
      createEvaluatorCommand("quick-relevancy", { type: "ragas/answer_relevancy" }),
    ).rejects.toThrow(ProcessExitError);

    const printed = vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");
    const doc = JSON.parse(printed) as {
      ok: boolean;
      error: {
        code: string;
        reasons: { kind: string; meta: { field: string; expected: string[]; received: string } }[];
      };
    };
    expect(doc.ok).toBe(false);
    expect(doc.error.code).toBe("validation_error");
    const reason = doc.error.reasons[0]!;
    expect(reason.kind).toBe("schema_failure");
    expect(reason.meta.field).toBe("type");
    expect(reason.meta.expected).toContain("ragas/response_relevancy");
    expect(reason.meta.received).toBe("ragas/answer_relevancy");
  });
});

describe("listEvaluatorTypesCommand()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when listing the embedded catalog", () => {
    /** @scenario Valid evaluator types can be listed without touching the API */
    it("returns every type with slug, name, and category without any API call", async () => {
      const { listEvaluatorTypesCommand } = await import("../types.js");

      const result = listEvaluatorTypesCommand();

      const entries = result.data as {
        slug: string;
        name: string;
        category: string;
      }[];
      expect(entries.length).toBeGreaterThan(30);
      const slugs = entries.map((entry) => entry.slug);
      expect(slugs).toContain("ragas/response_relevancy");
      expect(slugs).toContain("langwatch/api_keys_and_secrets_detection");
      for (const entry of entries) {
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.category.length).toBeGreaterThan(0);
      }
      // The catalog is embedded at build: no service constructed, no fetch.
      expect(EvaluatorsApiService).not.toHaveBeenCalled();
    });
  });
});

describe("deleteEvaluatorCommand()", () => {
  let mockGet: ReturnType<typeof vi.fn>;
  let mockDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet = vi.fn();
    mockDelete = vi.fn();
    vi.mocked(EvaluatorsApiService).mockImplementation(function () { return ({
      getAll: vi.fn(),
      get: mockGet,
      create: vi.fn(),
      delete: mockDelete,
    }) as unknown as EvaluatorsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
  });

  describe("when evaluator exists and deletion succeeds", () => {
    it("resolves by slug then deletes by ID", async () => {
      mockGet.mockResolvedValue(makeEvaluator());
      mockDelete.mockResolvedValue({ success: true });

      await deleteEvaluatorCommand("test-evaluator");

      expect(mockGet).toHaveBeenCalledWith("test-evaluator");
      expect(mockDelete).toHaveBeenCalledWith("evaluator_abc123");
    });
  });

  describe("when evaluator is not found", () => {
    it("exits with code 1 without calling delete", async () => {
      mockGet.mockRejectedValue(
        new EvaluatorsApiError("Not found", "fetch evaluator"),
      );

      await expect(deleteEvaluatorCommand("nonexistent")).rejects.toThrow(ProcessExitError);
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe("when delete API call fails", () => {
    it("exits with code 1", async () => {
      mockGet.mockResolvedValue(makeEvaluator());
      mockDelete.mockRejectedValue(
        new EvaluatorsApiError("Server error", "delete evaluator"),
      );

      await expect(deleteEvaluatorCommand("test-evaluator")).rejects.toThrow(ProcessExitError);
    });
  });
});

/**
 * The migrated commands register `-f, --format` with a commander DEFAULT
 * ("table"/"digest"), so `options.format` is always defined. Passing it
 * explicitly into failSpinner made it beat the format the program's preAction
 * hook recorded — failures rendered as human prose even under `-o json` /
 * `--agent`. These tests simulate exactly what the hook does
 * (applyOutputContext over the resolved options, commander default included)
 * and then fail the command.
 */
describe("listEvaluatorsCommand() failure shape under machine formats", () => {
  let mockGetAll: ReturnType<typeof vi.fn>;
  let savedChalkLevel: typeof chalk.level;

  beforeEach(() => {
    vi.clearAllMocks();
    savedChalkLevel = chalk.level;
    mockGetAll = vi.fn();
    vi.mocked(EvaluatorsApiService).mockImplementation(function () { return ({
      getAll: mockGetAll,
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    }) as unknown as EvaluatorsApiService; });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
    mockProcessExit();
    mockGetAll.mockRejectedValue(
      new EvaluatorsApiError("boom", "fetch all evaluators"),
    );
  });

  afterEach(async () => {
    // Undo the preAction simulation: reset the recorded format and colour.
    chalk.level = savedChalkLevel;
    await applyOutputContext(resolveOutputOptions({}, {}));
  });

  const printedStdout = (): string =>
    vi.mocked(console.log).mock.calls.map((call) => String(call[0])).join("\n");

  it("emits the structured JSON error document under -o json, despite the -f commander default", async () => {
    // What preAction resolves for `-o json`: the -f default "table" sits on
    // the same options object and must not win.
    await applyOutputContext(resolveOutputOptions({ output: "json", format: "table" }, {}));

    await expect(listEvaluatorsCommand()).rejects.toThrow(ProcessExitError);

    const doc = JSON.parse(printedStdout()) as { ok: boolean; error: { message: string } };
    expect(doc.ok).toBe(false);
    expect(doc.error.message).toContain("boom");
  });

  it("emits the structured JSON error document under --agent, despite the -f commander default", async () => {
    await applyOutputContext(resolveOutputOptions({ agent: true, format: "table" }, {}));

    await expect(listEvaluatorsCommand()).rejects.toThrow(ProcessExitError);

    const doc = JSON.parse(printedStdout()) as { ok: boolean };
    expect(doc.ok).toBe(false);
  });

  it("still emits JSON errors when a human passes -f json explicitly", async () => {
    await applyOutputContext(resolveOutputOptions({ format: "json" }, {}));

    await expect(listEvaluatorsCommand()).rejects.toThrow(ProcessExitError);

    const doc = JSON.parse(printedStdout()) as { ok: boolean };
    expect(doc.ok).toBe(false);
  });

  it("keeps the human error block when no machine format was asked for", async () => {
    await applyOutputContext(resolveOutputOptions({ format: "table" }, {}));

    await expect(listEvaluatorsCommand()).rejects.toThrow(ProcessExitError);

    expect(() => JSON.parse(printedStdout())).toThrow();
  });
});
