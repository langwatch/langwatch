/**
 * @vitest-environment node
 *
 * @see specs/workflows/workflow-node-owned-llm.feature
 *
 * The persistence chokepoint that guarantees every persisted llm
 * parameter carries a model — with an empty model-config cascade
 * (fresh install, env-key-only providers) it must still fill one in.
 * Seeding defaults is never a precondition for creating workflows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../modelProviders/resolveModelForFeature", () => ({
  resolveModelForFeature: vi.fn(),
}));

import { DEFAULT_MODEL } from "../../../utils/constants";
import { resolveModelForFeature } from "../../modelProviders/resolveModelForFeature";
import { materializeNodeLlmConfigs } from "../materializeNodeLlmConfigs";

const prisma = {} as never;

const dslWith = (llmValue: unknown, extra?: Record<string, unknown>) => ({
  ...extra,
  nodes: [
    {
      data: {
        parameters: [
          { identifier: "llm", type: "llm", value: llmValue },
          { identifier: "instructions", type: "str", value: "hi" },
        ],
      },
    },
  ],
});

describe("materializeNodeLlmConfigs", () => {
  beforeEach(() => {
    vi.mocked(resolveModelForFeature).mockReset();
  });

  it("fills a modelless llm parameter from the cascade-resolved default", async () => {
    vi.mocked(resolveModelForFeature).mockResolvedValue({
      model: "anthropic/claude-haiku-4-5",
    } as never);
    const dsl = dslWith(undefined);

    await materializeNodeLlmConfigs({ prisma, projectId: "p1", dsl });

    expect(resolveModelForFeature).toHaveBeenCalledWith(
      "workflows.create_default",
      expect.objectContaining({ projectId: "p1" }),
    );
    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: "anthropic/claude-haiku-4-5",
    });
  });

  it("falls back to DEFAULT_MODEL when nothing is configured at any scope", async () => {
    vi.mocked(resolveModelForFeature).mockRejectedValue(
      new Error("nothing configured"),
    );
    const dsl = dslWith({ model: "", temperature: 0.2 });

    await materializeNodeLlmConfigs({ prisma, projectId: "p1", dsl });

    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: DEFAULT_MODEL,
      temperature: 0.2,
    });
  });

  it("prefers the payload's legacy default_llm over the cascade and drops the field", async () => {
    const dsl = dslWith(undefined, {
      default_llm: { model: "openai/gpt-5-mini", max_tokens: 256 },
    });

    await materializeNodeLlmConfigs({ prisma, projectId: "p1", dsl });

    expect(resolveModelForFeature).not.toHaveBeenCalled();
    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: "openai/gpt-5-mini",
      max_tokens: 256,
    });
    expect("default_llm" in dsl).toBe(false);
  });

  it("leaves node-owned models untouched and skips the resolver entirely", async () => {
    const dsl = dslWith(
      { model: "gemini/gemini-2.5-flash" },
      { default_llm: { model: "openai/gpt-5-mini" } },
    );

    await materializeNodeLlmConfigs({ prisma, projectId: "p1", dsl });

    expect(resolveModelForFeature).not.toHaveBeenCalled();
    expect(dsl.nodes[0]!.data.parameters[0]!.value).toEqual({
      model: "gemini/gemini-2.5-flash",
    });
    expect("default_llm" in dsl).toBe(false);
  });
});
