/**
 * @vitest-environment jsdom
 *
 * Content-breakdown section in the trace summary (ADR-033). A coding-agent
 * trace whose fold rolled up per-category blockcat totals onto its summary
 * attributes shows a "Content breakdown" accordion with a lane per content
 * category — including `skill_content`, the lane a codex skill has no waterfall
 * span for. A trace with no classified content shows no such section.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  InputCategory,
  OutputCategory,
} from "~/server/app-layer/traces/block-classification/categories";
import { TraceSummaryAccordions } from "../TraceSummaryAccordions";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({
    isRedacted: false,
    isLoading: false,
    visibleTo: null,
  }),
}));

vi.mock("../../../../hooks/useTraceEvents", () => ({
  useTraceEvents: () => ({ events: [], isLoading: false }),
}));

vi.mock("../../../../hooks/useTraceResources", () => ({
  useTraceResources: () => ({
    resourceAttributes: {},
    isLoading: false,
    scope: undefined,
  }),
}));

vi.mock("../../../../hooks/useTraceEvaluations", () => ({
  useTraceEvaluations: () => ({ rich: [], pendingCount: 0, isLoading: false }),
}));

vi.mock("../../../../stores/focusSectionStore", () => ({
  useFocusSectionStore: (selector: (s: { request: () => void }) => unknown) =>
    selector({ request: () => undefined }),
}));

vi.mock("../useSectionFocusGlow", () => ({
  useSectionFocusGlow: () => ({ glow: null, handleGlowDone: () => undefined }),
}));

// Force the Content-breakdown section open so its (lazy-mounted) children render.
// `useSectionPresenceStore` MUST be stubbed too: every AccordionShell `Section`
// reads it unconditionally (traceId/tab → trackPresence), so a partial mock that
// omits it makes the export `undefined` and crashes the render.
vi.mock("../sectionPresence", () => ({
  useAutoOpenSections: () => [["io", "content"], () => undefined],
  useSyncSectionPresence: () => undefined,
  useSectionPresenceStore: (
    selector: (s: { traceId: string | null; tab: string | null }) => unknown,
  ) => selector({ traceId: null, tab: null }),
}));

function traceWith(attributes: Record<string, string>): TraceHeader {
  return {
    traceId: "trace-1",
    timestamp: 1_700_000_000_000,
    name: "trace-1",
    attributes,
    status: "success",
    containsPrompt: false,
    spanCount: 1,
    models: [],
  } as unknown as TraceHeader;
}

const renderAccordions = (trace: TraceHeader) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TraceSummaryAccordions trace={trace} spans={[]} />
    </ChakraProvider>,
  );

afterEach(cleanup);

describe("TraceSummaryAccordions content breakdown", () => {
  describe("given a trace with classified coding-agent content", () => {
    it("renders the Content breakdown section with the skill_content lane", () => {
      renderAccordions(
        traceWith({
          [blockCategoryTokensAttr(InputCategory.SYSTEM_PROMPT)]: "3997",
          [blockCategoryCostAttr(InputCategory.SYSTEM_PROMPT)]: "0.02",
          [blockCategoryTokensAttr(InputCategory.SKILL_CONTENT)]: "279",
          [blockCategoryCostAttr(InputCategory.SKILL_CONTENT)]: "0.0013953165",
          [blockCategoryTokensAttr(OutputCategory.ASSISTANT_TEXT)]: "36",
          [blockCategoryCostAttr(OutputCategory.ASSISTANT_TEXT)]: "0.001",
        }),
      );

      expect(screen.getByText("Content breakdown")).toBeInTheDocument();
      // The skill lane the codex waterfall could never show.
      expect(screen.getByText("Skill content")).toBeInTheDocument();
      expect(screen.getByText("System prompt")).toBeInTheDocument();
    });
  });

  describe("given a trace with no classified content", () => {
    it("does not render the Content breakdown section", () => {
      renderAccordions(traceWith({ "gen_ai.usage.input_tokens": "1000" }));

      expect(screen.queryByText("Content breakdown")).not.toBeInTheDocument();
    });
  });
});
