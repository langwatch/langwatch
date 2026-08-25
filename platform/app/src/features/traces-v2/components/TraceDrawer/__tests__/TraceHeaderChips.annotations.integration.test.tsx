/**
 * @vitest-environment jsdom
 *
 * The drawer header's annotations chip. It counts the annotations on the whole
 * conversation and takes the reader to the Conversation view, where each one
 * reads beside the turn it is about. See specs/traces-v2/annotations.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  setViewMode: vi.fn(),
  annotations: [] as unknown[],
}));

vi.mock("../../../hooks/useTraceHeaderChips", () => ({
  useTraceHeaderChips: () => ({ chips: [] }),
}));

vi.mock("../../../hooks/useConversationTurns", () => ({
  useConversationTurns: () => ({ data: { items: [{ traceId: "trace-2" }] } }),
}));

vi.mock("../../../hooks/useConversationAnnotations", () => ({
  useConversationAnnotations: () => ({
    byTrace: new Map(),
    byAnchor: new Map(),
    all: mocks.annotations,
    hasAny: mocks.annotations.length > 0,
    isLoading: false,
  }),
}));

// The trace as the reader sees it, which is what tells a comment left on a
// span the trace still has from one left on a span a correction removed.
vi.mock("../../../hooks/useSpanTree", () => ({
  useSpanTree: () => ({ data: [{ spanId: "span-7", name: "web_search" }] }),
}));

vi.mock("../../../stores/drawerStore", () => ({
  useDrawerStore: (selector: (state: unknown) => unknown) =>
    selector({ setViewMode: mocks.setViewMode }),
}));

import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { TraceHeaderChips } from "../TraceHeaderChips";

function annotation(over: Record<string, unknown> = {}) {
  return {
    id: "annotation-1",
    traceId: "trace-1",
    comment: "the model invented a policy number",
    expectedOutput: null,
    email: null,
    user: { id: "user-1", name: "Ada", image: null },
    createdAt: new Date("2026-08-01T10:30:00Z"),
    ...over,
  };
}

function renderChips({ conversationId }: { conversationId: string | null }) {
  const trace = {
    traceId: "trace-1",
    conversationId,
  } as unknown as TraceHeader;
  return render(
    <ChakraProvider value={defaultSystem}>
      <TraceHeaderChips trace={trace} onSelectSpan={vi.fn()} onOpenPromptsTab={vi.fn()} />
    </ChakraProvider>,
  );
}

const annotationsChip = () => screen.getByRole("button", { name: /Annotations/ });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.annotations = [];
  cleanup();
});

describe("given a conversation nobody has annotated", () => {
  it("shows no annotations chip", () => {
    renderChips({ conversationId: "thread-1" });

    expect(screen.queryByRole("button", { name: /Annotations/ })).not.toBeInTheDocument();
  });
});

describe("given a conversation carrying annotations", () => {
  beforeEach(() => {
    mocks.annotations = [annotation()];
  });

  it("counts them on the chip", () => {
    renderChips({ conversationId: "thread-1" });

    expect(annotationsChip()).toHaveTextContent("1");
  });

  describe("when the reader opens the chip", () => {
    it("says where the annotations are read", async () => {
      renderChips({ conversationId: "thread-1" });

      await userEvent.click(annotationsChip());

      expect(
        await screen.findByText(
          "Annotations appear beside each turn in the Conversation view.",
        ),
      ).toBeInTheDocument();
    });

    it("takes the reader to the conversation", () => {
      renderChips({ conversationId: "thread-1" });

      fireEvent.click(annotationsChip());

      expect(mocks.setViewMode).toHaveBeenCalledWith("conversation");
    });
  });
});

describe("given an annotated trace that belongs to no conversation", () => {
  beforeEach(() => {
    mocks.annotations = [annotation()];
  });

  describe("when the reader opens the chip", () => {
    it("stays where it is, there being no conversation to open", () => {
      renderChips({ conversationId: null });

      fireEvent.click(annotationsChip());

      expect(mocks.setViewMode).not.toHaveBeenCalled();
    });
  });
});
