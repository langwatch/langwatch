import { describe, expect, it } from "vitest";
import {
  buildCustomModelDisplayNames,
  modelDisplayLabel,
  type ModelProviderEditorValue,
} from "../index";

function provider(
  overrides: Partial<ModelProviderEditorValue> & { provider: string },
): ModelProviderEditorValue {
  return {
    enabled: true,
    customModels: null,
    customEmbeddingsModels: null,
    ...overrides,
  };
}

describe("model-provider display names", () => {
  it("resolves configured labels for chat and embedding entries", () => {
    const names = buildCustomModelDisplayNames([
      provider({
        provider: "custom",
        customModels: [{ modelId: "chat-model", displayName: "Chat", mode: "chat" }],
        customEmbeddingsModels: [
          { modelId: "embedding-model", displayName: "Embedding", mode: "embedding" },
        ],
      }),
    ]);

    expect(names).toEqual({
      "custom/chat-model": "Chat",
      "custom/embedding-model": "Embedding",
    });
  });

  it("uses the narrowest scope regardless of provider row order", () => {
    const organization = provider({
      provider: "custom",
      id: "org-row",
      scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
      customModels: [{ modelId: "model", displayName: "Org", mode: "chat" }],
    });
    const project = provider({
      provider: "custom",
      id: "project-row",
      scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
      customModels: [{ modelId: "model", displayName: "Project", mode: "chat" }],
    });

    expect(buildCustomModelDisplayNames([organization, project])).toEqual({
      "custom/model": "Project",
      "org-row/model": "Org",
      "project-row/model": "Project",
    });
  });

  it("falls back to the model family when no configured label exists", () => {
    expect(
      modelDisplayLabel({
        fullModelId: "custom/model",
        displayNames: { "custom/model": "" },
      }),
    ).toBe("model");
  });
});
