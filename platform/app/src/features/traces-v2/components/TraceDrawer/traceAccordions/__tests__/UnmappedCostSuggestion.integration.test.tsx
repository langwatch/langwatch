/**
 * @vitest-environment jsdom
 *
 * Unmapped-cost suggestion in the span detail pane: shows when the span
 * detail carries `costSuggestion`, opens the model costs page prefilled in
 * a new window. Renders the real SpanAccordions tree with the span-detail
 * data hook as the mocked boundary.
 *
 * Spec: specs/traces-v2/span-unmapped-cost-suggestion.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SpanDetail,
  SpanTreeNode,
} from "~/server/api/routers/tracesV2.schemas";
import { SpanAccordions } from "../SpanAccordions";

const { mockDetailState } = vi.hoisted(() => ({
  mockDetailState: { current: null as SpanDetail | null },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project" },
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../hooks/useSpanDetail", () => ({
  useSpanDetail: () => ({
    data: mockDetailState.current,
    isLoading: false,
  }),
}));

vi.mock("../../../../hooks/useTraceResources", () => ({
  useTraceResources: () => ({ bySpanId: {}, isLoading: false }),
}));

// RedactedField (wrapping the IO viewers) reads field-redaction status via a
// tRPC query; this test renders without that provider, so stub the hook to the
// not-redacted passthrough — redaction is out of scope for the cost suggestion.
vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({
    isRedacted: false,
    isLoading: false,
    visibleTo: null,
  }),
}));

const span: SpanTreeNode = {
  spanId: "span-1",
  parentSpanId: null,
  name: "chat completion",
  type: "llm",
  startTimeMs: 1_750_000_000_000,
  endTimeMs: 1_750_000_000_500,
  durationMs: 500,
  status: "ok",
  model: "vertex_ai/gemini-3-pro-preview",
  cost: null,
};

function makeDetail(overrides: Partial<SpanDetail> = {}): SpanDetail {
  return {
    spanId: "span-1",
    parentSpanId: null,
    name: "chat completion",
    type: "llm",
    startTimeMs: 1_750_000_000_000,
    endTimeMs: 1_750_000_000_500,
    durationMs: 500,
    status: "ok",
    model: "vertex_ai/gemini-3-pro-preview",
    metrics: {
      promptTokens: 1200,
      completionTokens: 80,
      cost: null,
    },
    events: [],
    costSuggestion: { model: "vertex_ai/gemini-3-pro-preview" },
    ...overrides,
  };
}

const Wrapper = ({ children }: { children?: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderSpanDetail() {
  return render(<SpanAccordions traceId="trace-1" span={span} />, {
    wrapper: Wrapper,
  });
}

describe("Feature: Unmapped model cost suggestion in span details", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "open").mockReturnValue(null);
    mockDetailState.current = makeDetail();
  });

  describe("when the span has a model and tokens but no cost mapped", () => {
    /** @scenario Span with model and tokens but no cost shows a cost mapping suggestion */
    it("shows the suggestion inside the Attributes section with the model name and an add button", () => {
      renderSpanDetail();

      const suggestion = screen.getByTestId("unmapped-cost-suggestion");
      expect(suggestion).toHaveTextContent("no cost mapped");
      expect(suggestion).toHaveTextContent("vertex_ai/gemini-3-pro-preview");
      // The banner lives inside the span's Attributes accordion section,
      // above the attribute table and its filter input.
      expect(suggestion.closest('[data-section="attributes"]')).not.toBeNull();
      expect(suggestion.closest('[data-section="io"]')).toBeNull();
      expect(
        screen.getByRole("button", { name: /add cost mapping/i }),
      ).toBeInTheDocument();
    });

    /** @scenario Suggestion opens the model costs page prefilled in a new window */
    /** @scenario Generated regex escapes special characters */
    it("opens the model costs page prefilled in a new window", () => {
      renderSpanDetail();

      fireEvent.click(
        screen.getByRole("button", { name: /add cost mapping/i }),
      );

      expect(window.open).toHaveBeenCalledTimes(1);
      const [url, target] = vi.mocked(window.open).mock.calls[0]!;
      const parsed = new URL(`http://localhost${url as string}`);
      expect(parsed.pathname).toBe("/settings/model-costs");
      expect(parsed.searchParams.get("drawer.open")).toBe("llmModelCost");
      expect(parsed.searchParams.get("drawer.prefillModel")).toBe(
        "vertex_ai/gemini-3-pro-preview",
      );
      expect(parsed.searchParams.get("drawer.prefillRegex")).toBe(
        "^vertex_ai\\/gemini-3-pro-preview$",
      );
      expect(target).toBe("_blank");
    });
  });

  describe("when no suggestion applies to the span", () => {
    it("renders nothing when the span detail carries no costSuggestion", () => {
      mockDetailState.current = makeDetail({ costSuggestion: null });

      renderSpanDetail();

      expect(
        screen.queryByTestId("unmapped-cost-suggestion"),
      ).not.toBeInTheDocument();
    });
  });
});
