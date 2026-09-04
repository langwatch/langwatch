import { describe, expect, it, vi } from "vitest";
import { ModelNotConfiguredError, type ModelProviderService } from "@langwatch/model-provider-contract";
import type { StudioWorkflow } from "@langwatch/workflow-contract";
import { ModelProviderWorkflowStudioDslAdapter } from "../workflow-studio-dsl.adapter";

function signatureNode(llmValue: unknown) {
  return {
    id: "sig-1",
    type: "signature",
    position: { x: 0, y: 0 },
    data: {
      name: "Signature",
      parameters: [{ identifier: "llm", type: "llm", value: llmValue }],
    },
  };
}

function buildDsl(overrides: Record<string, unknown> = {}): StudioWorkflow {
  return {
    spec_version: "1.5",
    workflow_id: "wf-1",
    name: "Test",
    icon: "🧩",
    description: "",
    version: "1",
    template_adapter: "default",
    enable_tracing: true,
    nodes: [signatureNode(undefined)],
    edges: [],
    state: {},
    ...overrides,
  } as unknown as StudioWorkflow;
}

function buildAdapter(resolveModelForFeature: ReturnType<typeof vi.fn>) {
  const modelProviders = { resolveModelForFeature } as unknown as ModelProviderService;
  return ModelProviderWorkflowStudioDslAdapter.create({ modelProviders });
}

describe("ModelProviderWorkflowStudioDslAdapter materializing node LLM configs", () => {
  describe("given a fresh install with no default model configured anywhere", () => {
    /** @scenario Creating a workflow on a fresh install starts it with a ready-to-use model */
    it("fills the modelless LLM node with the registry flagship", async () => {
      const resolveModelForFeature = vi.fn(async () => {
        throw new ModelNotConfiguredError(
          "workflows.create_default",
          "DEFAULT",
          "Workflow default",
          "project-1",
        );
      });
      const adapter = buildAdapter(resolveModelForFeature);

      const prepared = await adapter.prepare({ projectId: "project-1", dsl: buildDsl() });

      const llmParam = prepared.nodes[0]!.data.parameters!.find((p) => p.type === "llm")!;
      const model = (llmParam.value as { model?: string } | undefined)?.model;
      expect(model).toBeTruthy();
      expect(model).not.toBe("");
    });
  });

  describe("given a configured default model for the project", () => {
    /** @scenario Creating a workflow uses the configured default model when one is set */
    it("fills the modelless LLM node with the cascade-resolved model", async () => {
      const resolveModelForFeature = vi.fn(async () => ({
        model: "anthropic/claude-haiku-4-5-20251001",
      }));
      const adapter = buildAdapter(resolveModelForFeature);

      const prepared = await adapter.prepare({ projectId: "project-1", dsl: buildDsl() });

      const llmParam = prepared.nodes[0]!.data.parameters!.find((p) => p.type === "llm")!;
      expect((llmParam.value as { model?: string }).model).toBe(
        "anthropic/claude-haiku-4-5-20251001",
      );
      expect(resolveModelForFeature).toHaveBeenCalledWith({
        projectId: "project-1",
        featureKey: "workflows.create_default",
      });
    });
  });

  describe("given a payload from an older client carrying a workflow-wide default_llm", () => {
    /** @scenario A workflow created by an older client keeps its old workflow-wide model */
    it("folds the legacy default_llm into the modelless node and drops the field", async () => {
      const resolveModelForFeature = vi.fn();
      const adapter = buildAdapter(resolveModelForFeature);

      const prepared = await adapter.prepare({
        projectId: "project-1",
        dsl: buildDsl({
          default_llm: { model: "openai/gpt-5-mini", max_tokens: 256 },
        }),
      });

      const llmParam = prepared.nodes[0]!.data.parameters!.find((p) => p.type === "llm")!;
      expect(llmParam.value).toEqual({ model: "openai/gpt-5-mini", max_tokens: 256 });
      expect("default_llm" in prepared).toBe(false);
      // The legacy field satisfied the fill, so the cascade is never consulted.
      expect(resolveModelForFeature).not.toHaveBeenCalled();
    });
  });

  describe("given an LLM node that already carries an explicit model", () => {
    /** @scenario An explicit node-owned model is never rewritten */
    it("keeps the explicit model untouched", async () => {
      const resolveModelForFeature = vi.fn(async () => ({ model: "openai/gpt-5-mini" }));
      const adapter = buildAdapter(resolveModelForFeature);

      const prepared = await adapter.prepare({
        projectId: "project-1",
        dsl: buildDsl({ nodes: [signatureNode({ model: "gemini/gemini-2.5-flash" })] }),
      });

      const llmParam = prepared.nodes[0]!.data.parameters!.find((p) => p.type === "llm")!;
      expect((llmParam.value as { model?: string }).model).toBe("gemini/gemini-2.5-flash");
      expect(resolveModelForFeature).not.toHaveBeenCalled();
    });
  });
});
