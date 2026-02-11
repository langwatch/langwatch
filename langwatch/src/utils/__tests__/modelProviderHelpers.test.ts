import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL } from "../constants";

// Mock the registry module so we can control getProviderModelOptions
vi.mock("../../server/modelProviders/registry", () => ({
  getProviderModelOptions: vi.fn().mockReturnValue([]),
}));

import { getProviderModelOptions } from "../../server/modelProviders/registry";
import {
  resolveModelForProvider,
  shouldAutoEnableAsDefault,
} from "../modelProviderHelpers";

const mockGetProviderModelOptions = vi.mocked(getProviderModelOptions);

describe("resolveModelForProvider", () => {
  it("returns current model when it already matches the provider", () => {
    const result = resolveModelForProvider(
      "azure/gpt-4o",
      "azure",
      null,
      "chat",
    );

    expect(result).toBe("azure/gpt-4o");
  });

  it("picks from stored models first when current model does not match provider", () => {
    const result = resolveModelForProvider(
      "openai/gpt-5.2",
      "azure",
      ["gpt-4o", "gpt-4-turbo"],
      "chat",
    );

    expect(result).toBe("azure/gpt-4o");
  });

  it("falls back to registry models when no stored models exist", () => {
    mockGetProviderModelOptions.mockReturnValueOnce([
      { value: "claude-sonnet-4", label: "claude-sonnet-4" },
      { value: "claude-haiku-3.5", label: "claude-haiku-3.5" },
    ]);

    const result = resolveModelForProvider(
      "openai/gpt-5.2",
      "anthropic",
      null,
      "chat",
    );

    expect(result).toBe("anthropic/claude-sonnet-4");
    expect(mockGetProviderModelOptions).toHaveBeenCalledWith(
      "anthropic",
      "chat",
    );
  });

  it("returns current model when no provider models exist in stored or registry", () => {
    mockGetProviderModelOptions.mockReturnValueOnce([]);

    const result = resolveModelForProvider(
      "openai/gpt-5.2",
      "custom-provider",
      null,
      "chat",
    );

    expect(result).toBe("openai/gpt-5.2");
  });

  it("resolves embedding models with mode 'embedding'", () => {
    mockGetProviderModelOptions.mockReturnValueOnce([
      {
        value: "text-embedding-3-small",
        label: "text-embedding-3-small",
      },
    ]);

    const result = resolveModelForProvider(
      "openai/text-embedding-3-small",
      "azure",
      null,
      "embedding",
    );

    expect(mockGetProviderModelOptions).toHaveBeenCalledWith(
      "azure",
      "embedding",
    );
    expect(result).toBe("azure/text-embedding-3-small");
  });
});

describe("shouldAutoEnableAsDefault", () => {
  it("returns true when provider is the default model provider", () => {
    const project = { defaultModel: "openai/gpt-4o" };

    const result = shouldAutoEnableAsDefault("openai", project, 5);

    expect(result).toBe(true);
  });

  it("returns true when enabledProvidersCount is 1", () => {
    const project = { defaultModel: "openai/gpt-5.2" };

    const result = shouldAutoEnableAsDefault("azure", project, 1);

    expect(result).toBe(true);
  });

  it("returns false when provider is not default and enabledProvidersCount > 1", () => {
    const project = { defaultModel: "openai/gpt-5.2" };

    const result = shouldAutoEnableAsDefault("azure", project, 2);

    expect(result).toBe(false);
  });

  it("returns true when project is null and provider matches DEFAULT_MODEL", () => {
    const expectedProvider = DEFAULT_MODEL.split("/")[0]!;

    const result = shouldAutoEnableAsDefault(expectedProvider, null, 3);

    expect(result).toBe(true);
  });

  it("returns true when project is null and enabledProvidersCount is 1", () => {
    const result = shouldAutoEnableAsDefault("azure", null, 1);

    expect(result).toBe(true);
  });
});
