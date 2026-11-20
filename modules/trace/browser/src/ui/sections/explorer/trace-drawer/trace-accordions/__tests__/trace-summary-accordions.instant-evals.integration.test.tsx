/**
 * The trace's kept Instant Evals results in the summary: their own section after Evals, and a
 * result read from a span naming that span.
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { InstantEvalTraceResultWire } from "@langwatch/instant-eval-contract";
import type { SpanTreeNode, TraceHeader } from "@langwatch/trace-contract";
import { cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstantEvalResultEntry } from "../../../../../../model/instant-eval-trace-results.ts";

const instantEvals = vi.hoisted(() => ({ results: [] as InstantEvalResultEntry[] }));

vi.mock("../../../../../../behavior/trace-host.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTraceHost: () => ({ hasPermission: () => true }),
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import("../../../../../../__tests__/window-location-router.ts")).windowLocationRouter,
}));

vi.mock("../../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
  }),
}));

vi.mock("../../../../use-field-redaction.ts", () => ({
  useFieldRedaction: () => ({ isRedacted: false, isLoading: false }),
}));

vi.mock("../../../../../../behavior/explorer/use-trace-edit-overlay.ts", () => ({
  useAppliedTraceEditPatch: () => null,
}));

// The trace's comments are read once per surface. This suite is about the
// Instant Evals section, so the surface reads none.
vi.mock("../../../../../../features/annotation/behavior/use-anchored-annotations.ts", () => ({
  useAnchoredAnnotations: () => ({
    commentsAt: () => [],
    all: [],
    isLoading: false,
  }),
}));

vi.mock("../../anchored-comments/anchor-comment-button.tsx", () => ({
  AnchorCommentButton: () => null,
}));

vi.mock("../../../../../../features/trace-drawer/behavior/use-trace-header.ts", () => ({
  useTraceHeaderCanonical: () => ({ data: undefined }),
}));

vi.mock("../../../../../../features/trace-drawer/behavior/use-text-translation.ts", () => ({
  useTextTranslation: ({ texts }: { texts: Record<string, string> }) => ({
    displayTexts: texts,
    isActive: false,
    isLoading: false,
    toggle: () => undefined,
  }),
}));

vi.mock("../../../../../../features/trace-drawer/behavior/use-trace-events.ts", () => ({
  useTraceEvents: () => ({ events: [], isLoading: false }),
}));

// One pending evaluation gives the Evals section content, so it renders as its own section.
vi.mock("../../../../../../features/trace-drawer/behavior/use-trace-evaluations.ts", () => ({
  useTraceEvaluations: () => ({
    rich: [],
    pendingCount: 1,
    retrying: [],
    isLoading: false,
  }),
}));

vi.mock(
  "../../../../../../features/trace-drawer/behavior/use-trace-instant-eval-results.ts",
  () => ({
    useTraceInstantEvalResults: () => ({
      isShown: true,
      results: instantEvals.results,
      isLoading: false,
    }),
  }),
);

vi.mock("../../../hooks/use-trace-resources.ts", () => ({
  useTraceResources: () => ({
    rootSpanId: null,
    resourceAttributes: {},
    scope: null,
    spans: [],
    bySpanId: {},
    isLoading: false,
  }),
}));

import {
  openTraceDrawerAt,
  setWindowAddress,
} from "../../../../../../__tests__/window-location-router.ts";
import { toInstantEvalResultEntry } from "../../../../../../model/instant-eval-trace-results.ts";
import { TraceSummaryAccordions } from "../trace-summary-accordions.tsx";

const TRACE_ID = "trace-1";
const SPAN_ID = "span-1";
const SPAN_NAME = "call-openai";

const header = (): TraceHeader => ({
  traceId: TRACE_ID,
  timestamp: 1_000,
  name: "trace",
  serviceName: "svc",
  origin: "application",
  conversationId: null,
  userId: null,
  durationMs: 1,
  models: [],
  totalCost: null,
  nonBilledCost: 0,
  totalTokens: 0,
  inputTokens: null,
  outputTokens: null,
  tokensEstimated: false,
  traceName: "trace",
  rootSpanType: null,
  scenarioRunId: null,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  status: "ok",
  spanCount: 1,
  input: "what is the weather in Berlin?",
  output: "mild",
  attributes: {},
});

const SPANS: SpanTreeNode[] = [
  {
    spanId: SPAN_ID,
    parentSpanId: null,
    name: SPAN_NAME,
    type: "llm",
    startTimeMs: 1_000,
    endTimeMs: 1_001,
    durationMs: 1,
    status: "ok",
    model: null,
  },
];

function result(overrides: Partial<InstantEvalTraceResultWire>): InstantEvalTraceResultWire {
  return {
    spanId: "",
    judgedColumn: "llm_readable_trace",
    question: "Is the customer annoyed?",
    kind: "boolean",
    status: "judged",
    probability: 0.87,
    score: null,
    label: null,
    judgeModel: "langwatch/instant-evals",
    judgedAt: 1_762_000_000_000,
    source: "ask",
    sourceId: "query-1",
    ...overrides,
  };
}

function sectionOrder(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll("[data-section]"), (element) =>
    element.getAttribute("data-section"),
  );
}

function instantEvalsSection(container: HTMLElement): HTMLElement {
  const section = container.querySelector<HTMLElement>('[data-section="instantEvals"]');
  if (!section) throw new Error("The summary rendered no Instant Evals section.");
  return section;
}

describe("the Instant Evals section of the trace summary", () => {
  beforeEach(() => {
    instantEvals.results = [
      toInstantEvalResultEntry(result({})),
      toInstantEvalResultEntry(
        result({
          spanId: SPAN_ID,
          judgedColumn: "llm_messages_span",
          question: "Did the model answer the question?",
          source: "run",
        }),
      ),
    ];
    openTraceDrawerAt({ traceId: TRACE_ID });
  });

  afterEach(() => {
    cleanup();
    setWindowAddress({ url: "/my-project/traces" });
  });

  describe("given release_instant_eval_results is on and the trace holds kept results", () => {
    describe("when the summary renders", () => {
      it("shows the Instant Evals section with each result", () => {
        const { container } = renderWithDesignSystem(
          <TraceSummaryAccordions trace={header()} spans={SPANS} />,
        );

        const section = instantEvalsSection(container);
        expect(within(section).getByText("Instant Evals")).toBeInTheDocument();
        expect(within(section).getByText("Is the customer annoyed?")).toBeInTheDocument();
        expect(within(section).getByText("Did the model answer the question?")).toBeInTheDocument();
      });

      it("orders the section straight after Evals", () => {
        const { container } = renderWithDesignSystem(
          <TraceSummaryAccordions trace={header()} spans={SPANS} />,
        );

        const order = sectionOrder(container);
        expect(order).toContain("evals");
        expect(order.indexOf("instantEvals")).toBe(order.indexOf("evals") + 1);
      });

      it("names the span a result was read from, and opens it when clicked", () => {
        const onSelectSpan = vi.fn();
        const { container } = renderWithDesignSystem(
          <TraceSummaryAccordions trace={header()} spans={SPANS} onSelectSpan={onSelectSpan} />,
        );
        const section = instantEvalsSection(container);

        const spanLink = within(section).getByRole("button", { name: SPAN_NAME });
        expect(
          within(section).getByText("Run · span messages · langwatch/instant-evals"),
        ).toBeInTheDocument();

        fireEvent.click(spanLink);
        expect(onSelectSpan).toHaveBeenCalledWith(SPAN_ID);
      });
    });
  });
});
