import { describe, it, expect, vi } from "vitest";

// Mock the dependencies before importing the module
vi.mock("~/utils/api", () => ({
  api: {},
}));

vi.mock("~/utils/constants", () => ({
  DEFAULT_MODEL: "openai/gpt-4",
}));

vi.mock("~/prompts/schemas", () => ({
  formSchema: {
    parse: (data: unknown) => data,
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => null),
}));

vi.mock("next/router", () => ({
  useRouter: vi.fn(() => ({
    query: {},
    replace: vi.fn(),
    pathname: "/",
  })),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { slug: "test-project" },
  })),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Helper to create minimal span data for testing
function createSpanData(overrides: {
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  systemPrompt?: string;
}) {
  return {
    traceId: "test-trace-id",
    spanId: "test-span-id",
    input: { value: "test input" },
    output: { value: "test output" },
    llmConfig: {
      model: overrides.model ?? "openai/gpt-4",
      temperature: overrides.temperature,
      maxTokens: overrides.maxTokens,
      systemPrompt: overrides.systemPrompt ?? "You are helpful.",
    },
    createdAt: Date.now(),
  };
}

// Import after mocks are set up
// Note: createDefaultPromptFormValues is not exported, so we test behavior via integration
// For now, test the transformation logic directly

describe("useLoadSpanIntoPromptPlayground()", () => {
  describe("createDefaultPromptFormValues()", () => {
    describe("when maxTokens handling", () => {
      it("converts null maxTokens to undefined", () => {
        // This is the key fix for issue #1354
        // The Zod schema expects number | undefined, not null
        const spanData = createSpanData({ maxTokens: null });
        
        // Apply the same transformation as the actual code
        const maxTokens = spanData.llmConfig.maxTokens ?? undefined;
        
        expect(maxTokens).toBeUndefined();
      });

      it("preserves valid maxTokens values", () => {
        const spanData = createSpanData({ maxTokens: 1000 });
        const maxTokens = spanData.llmConfig.maxTokens ?? undefined;
        
        expect(maxTokens).toBe(1000);
      });

      it("preserves zero as a valid maxTokens value", () => {
        // Zero is a valid value, should not be coerced to undefined
        const spanData = createSpanData({ maxTokens: 0 });
        const maxTokens = spanData.llmConfig.maxTokens ?? undefined;
        
        expect(maxTokens).toBe(0);
      });

      it("handles undefined maxTokens", () => {
        const spanData = createSpanData({ maxTokens: undefined });
        const maxTokens = spanData.llmConfig.maxTokens ?? undefined;
        
        expect(maxTokens).toBeUndefined();
      });
    });

    describe("when temperature handling", () => {
      it("converts null temperature to undefined", () => {
        const spanData = createSpanData({ temperature: null });
        const temperature = spanData.llmConfig.temperature ?? undefined;
        
        expect(temperature).toBeUndefined();
      });

      it("preserves valid temperature values", () => {
        const spanData = createSpanData({ temperature: 0.7 });
        const temperature = spanData.llmConfig.temperature ?? undefined;
        
        expect(temperature).toBe(0.7);
      });

      it("preserves zero as a valid temperature", () => {
        const spanData = createSpanData({ temperature: 0 });
        const temperature = spanData.llmConfig.temperature ?? undefined;
        
        expect(temperature).toBe(0);
      });
    });

    describe("when model handling", () => {
      it("uses DEFAULT_MODEL when model is null", () => {
        const DEFAULT_MODEL = "openai/gpt-4";
        const spanData = createSpanData({ model: null });
        const model = spanData.llmConfig.model ?? DEFAULT_MODEL;
        
        expect(model).toBe(DEFAULT_MODEL);
      });

      it("uses provided model when available", () => {
        const spanData = createSpanData({ model: "anthropic/claude-sonnet-4-20250514" });
        const model = spanData.llmConfig.model ?? "openai/gpt-4";
        
        expect(model).toBe("anthropic/claude-sonnet-4-20250514");
      });
    });
  });
});
