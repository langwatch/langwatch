import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../langwatch-api-evaluators.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    listEvaluators: vi.fn(),
    getEvaluator: vi.fn(),
    createEvaluator: vi.fn(),
    updateEvaluator: vi.fn(),
  };
});

import {
  listEvaluators,
  getEvaluator,
  createEvaluator,
  updateEvaluator,
} from "../langwatch-api-evaluators.js";

import { handleListEvaluators } from "../tools/list-evaluators.js";
import { handleGetEvaluator } from "../tools/get-evaluator.js";
import { handleCreateEvaluator } from "../tools/create-evaluator.js";
import { handleUpdateEvaluator } from "../tools/update-evaluator.js";

const mockListEvaluators = vi.mocked(listEvaluators);
const mockGetEvaluator = vi.mocked(getEvaluator);
const mockCreateEvaluator = vi.mocked(createEvaluator);
const mockUpdateEvaluator = vi.mocked(updateEvaluator);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleListEvaluators()", () => {
  const sampleEvaluators = [
    {
      id: "evaluator_abc123",
      projectId: "proj_1",
      name: "Toxicity Check",
      slug: "toxicity-check",
      type: "evaluator",
      config: { evaluatorType: "openai/moderation" },
      workflowId: null,
      copiedFromEvaluatorId: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      fields: [{ identifier: "input", type: "str" }],
      outputFields: [{ identifier: "passed", type: "bool" }],
    },
    {
      id: "evaluator_def456",
      projectId: "proj_1",
      name: "Exact Match",
      slug: "exact-match",
      type: "evaluator",
      config: { evaluatorType: "langevals/exact_match" },
      workflowId: null,
      copiedFromEvaluatorId: null,
      createdAt: "2024-01-02T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
      fields: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
      ],
      outputFields: [{ identifier: "passed", type: "bool" }],
    },
  ];

  describe("when evaluators exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListEvaluators.mockResolvedValue(sampleEvaluators);
      result = await handleListEvaluators();
    });

    it("includes evaluator id", () => {
      expect(result).toContain("evaluator_abc123");
    });

    it("includes evaluator name", () => {
      expect(result).toContain("Toxicity Check");
    });

    it("includes evaluator type", () => {
      expect(result).toContain("openai/moderation");
    });

    it("includes slug", () => {
      expect(result).toContain("toxicity-check");
    });

    it("includes all evaluators in the list", () => {
      expect(result).toContain("evaluator_def456");
    });

    it("includes the total count header", () => {
      expect(result).toContain("# Evaluators (2 total)");
    });
  });

  describe("when no evaluators exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListEvaluators.mockResolvedValue([]);
      result = await handleListEvaluators();
    });

    it("returns a no-evaluators message", () => {
      expect(result).toContain("No evaluators found");
    });

    it("includes a tip to use platform_create_evaluator", () => {
      expect(result).toContain("platform_create_evaluator");
    });
  });
});

describe("handleGetEvaluator()", () => {
  const sampleEvaluator = {
    id: "evaluator_abc123",
    projectId: "proj_1",
    name: "Toxicity Check",
    slug: "toxicity-check",
    type: "evaluator",
    config: {
      evaluatorType: "openai/moderation",
      settings: { model: "text-moderation-stable" },
    },
    workflowId: null,
    copiedFromEvaluatorId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    fields: [
      { identifier: "input", type: "str" },
      { identifier: "output", type: "str", optional: true },
    ],
    outputFields: [
      { identifier: "passed", type: "bool" },
      { identifier: "score", type: "float" },
    ],
  };

  describe("when evaluator is found", () => {
    let result: string;

    beforeEach(async () => {
      mockGetEvaluator.mockResolvedValue(sampleEvaluator);
      result = await handleGetEvaluator({ idOrSlug: "evaluator_abc123" });
    });

    it("includes the evaluator name in the heading", () => {
      expect(result).toContain("# Evaluator: Toxicity Check");
    });

    it("includes the evaluator type", () => {
      expect(result).toContain("openai/moderation");
    });

    it("includes the config as JSON", () => {
      expect(result).toContain("text-moderation-stable");
    });

    it("includes input fields", () => {
      expect(result).toContain("## Input Fields");
      expect(result).toContain("**input** (str)");
    });

    it("marks optional fields", () => {
      expect(result).toContain("(optional)");
    });

    it("includes output fields", () => {
      expect(result).toContain("## Output Fields");
      expect(result).toContain("**passed** (bool)");
    });
  });
});

describe("handleCreateEvaluator()", () => {
  describe("when creation succeeds", () => {
    let result: string;

    beforeEach(async () => {
      mockCreateEvaluator.mockResolvedValue({
        id: "evaluator_new123",
        projectId: "proj_1",
        name: "My LLM Judge",
        slug: "my-llm-judge",
        type: "evaluator",
        config: { evaluatorType: "langevals/llm_boolean" },
        workflowId: null,
        copiedFromEvaluatorId: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        fields: [{ identifier: "input", type: "str" }],
        outputFields: [{ identifier: "passed", type: "bool" }],
      });
      result = await handleCreateEvaluator({
        name: "My LLM Judge",
        config: { evaluatorType: "langevals/llm_boolean" },
      });
    });

    it("confirms creation", () => {
      expect(result).toContain("Evaluator created successfully!");
    });

    it("includes the generated ID", () => {
      expect(result).toContain("evaluator_new123");
    });

    it("includes the slug", () => {
      expect(result).toContain("my-llm-judge");
    });

    it("includes the evaluator type", () => {
      expect(result).toContain("langevals/llm_boolean");
    });
  });
});

describe("handleUpdateEvaluator()", () => {
  describe("when update succeeds", () => {
    let result: string;

    beforeEach(async () => {
      mockUpdateEvaluator.mockResolvedValue({
        id: "evaluator_abc123",
        projectId: "proj_1",
        name: "Updated Name",
        slug: "toxicity-check",
        type: "evaluator",
        config: { evaluatorType: "openai/moderation" },
        workflowId: null,
        copiedFromEvaluatorId: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        fields: [],
        outputFields: [],
      });
      result = await handleUpdateEvaluator({
        evaluatorId: "evaluator_abc123",
        name: "Updated Name",
      });
    });

    it("confirms update", () => {
      expect(result).toContain("Evaluator updated successfully!");
    });

    it("includes the evaluator ID", () => {
      expect(result).toContain("evaluator_abc123");
    });

    it("includes the updated name", () => {
      expect(result).toContain("Updated Name");
    });
  });
});
