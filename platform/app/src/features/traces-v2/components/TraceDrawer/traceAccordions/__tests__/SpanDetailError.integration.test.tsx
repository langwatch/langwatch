/**
 * @vitest-environment jsdom
 *
 * The span detail panel when its read fails.
 *
 * The waterfall and the rest of the drawer are unaffected — only this panel
 * has nothing to show — so the failure is reported in place. Renders the real
 * `SpanAccordions` with the span-detail data hook as the mocked boundary, and
 * lets the real `<HandledErrorAlert>` resolve the copy through the code-keyed
 * registry so what is asserted is what a customer reads.
 *
 * Spec: specs/traces-v2/data-layer.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { useDrawerStore } from "../../../../stores/drawerStore";
import { SpanAccordions } from "../SpanAccordions";

const { mockDetailState } = vi.hoisted(() => ({
  mockDetailState: { current: null as unknown },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project" },
    hasPermission: () => true,
  }),
}));

vi.mock("../../../../hooks/useSpanDetail", () => ({
  useSpanDetail: () => mockDetailState.current,
}));

vi.mock("../../../../hooks/useTraceResources", () => ({
  useTraceResources: () => ({ bySpanId: {}, isLoading: false }),
}));

vi.mock("../../../../hooks/useSpanLogs", () => ({
  useSpanLogs: () => ({ logsBySpanId: new Map(), isLoading: false }),
}));

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
  model: "gpt-5-mini",
  cost: null,
};

/**
 * What `tracesV2.spanDetail` actually puts on the wire for a missing span:
 * `SpanNotFoundError` serialised under `data.error` by the tRPC boundary, with
 * the wire `message` collapsed to the code slug (#5984).
 */
function spanNotFoundError() {
  return Object.assign(new Error("span_not_found"), {
    data: {
      code: "NOT_FOUND",
      httpStatus: 404,
      traceId: "0af7651916cd43dd8448eb211c80319c",
      error: {
        code: "span_not_found",
        httpStatus: 404,
        fault: "customer",
        meta: { spanId: "span-1" },
        tips: [
          "Check the span id — spans are deleted with their trace after the retention window",
        ],
        docsUrl: "https://docs.langwatch.ai/platform/data-retention",
      },
    },
  });
}

/** An infrastructure failure: no handled payload, so no registry entry. */
function unhandledError() {
  return Object.assign(new Error("Internal server error"), {
    data: {
      code: "INTERNAL_SERVER_ERROR",
      httpStatus: 500,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    },
  });
}

function detailErrorState(error: unknown) {
  return {
    data: undefined,
    isLoading: false,
    isError: true,
    error,
    refetch: vi.fn(),
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

describe("Feature: Span detail error surfacing", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    useDrawerStore.setState({ selectedSpanId: span.spanId });
  });

  describe("when the span detail read fails with span_not_found", () => {
    beforeEach(() => {
      mockDetailState.current = detailErrorState(spanNotFoundError());
    });

    /** @scenario "Span detail error does not crash drawer" */
    it("shows the registry copy for the failure instead of an empty accordion stack", () => {
      renderSpanDetail();

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Span not found");
      expect(alert).toHaveTextContent(
        "It may have been deleted along with its trace.",
      );
      expect(alert).toHaveTextContent(
        "Check the span id — spans are deleted with their trace after the retention window",
      );

      // The empty accordion stack this used to render in place of any
      // explanation — the blank panel that read as a load never finishing.
      expect(
        screen.queryByText("No additional attributes recorded"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("No events recorded")).not.toBeInTheDocument();
    });

    it("never shows the customer the code slug the wire message collapsed to", () => {
      renderSpanDetail();

      // Anchored on the alert being there: without it this would pass on an
      // empty panel, which is the bug rather than the fix.
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.queryByText(/span_not_found/)).not.toBeInTheDocument();
    });

    it("drops the span selection so the waterfall comes back, and offers no retry that cannot help", () => {
      renderSpanDetail();

      fireEvent.click(
        screen.getByRole("button", { name: /choose another span/i }),
      );
      expect(useDrawerStore.getState().selectedSpanId).toBeNull();

      expect(
        screen.queryByRole("button", { name: /try again/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the span detail read fails for a reason we cannot name", () => {
    /** @scenario "Span detail error we cannot name still explains itself" */
    it("shows the generic explanation and a retry", () => {
      const refetch = vi.fn();
      mockDetailState.current = {
        ...detailErrorState(unhandledError()),
        refetch,
      };

      renderSpanDetail();

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load this span");
      expect(
        screen.queryByText(/Internal server error/),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });
});
