/**
 * @vitest-environment jsdom
 *
 * The comment action on a field panel, where there is room to say what it is in
 * words, and the field that is hidden from the reader, which offers none.
 * See specs/traces-v2/anchored-comments.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AnnotationByTrace } from "../../../use-annotations-by-trace-ids";

const mocks = vi.hoisted(() => ({
  canManage: true,
  storedComments: [] as unknown[],
}));

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1" },
    hasPermission: (permission: string) =>
      permission === "annotations:manage" ? mocks.canManage : true,
  }),
}));

vi.mock("../../../../../behavior/auth-session", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("../../../../blocks/toaster", () => ({ toaster: { create: vi.fn() } }));

vi.mock("../../../me/use-personal-feature-gate", () => ({
  usePersonalFeatureGate: () => ({
    requestEnable: async () => true,
    dialogState: {},
  }),
}));

vi.mock("../../../me/personal-feature-gate-dialog", () => ({
  PersonalFeatureGateDialog: () => null,
}));

vi.mock("../../../../../behavior/prompts/use-load-span-into-prompt-playground", () => ({
  useGoToSpanInPlaygroundTabUrlBuilder: () => ({ buildUrl: () => null }),
}));

// The drawer drives redaction off the read's own flags, so the per-field query
// behind the shared marker is never consulted here.
vi.mock("../../../use-field-redaction", () => ({
  useFieldRedaction: () => ({
    isRedacted: undefined,
    isLoading: false,
    visibleTo: null,
  }),
}));

vi.mock("../../../trace-api", () => ({
  api: {
    useQueries: () => [{ data: mocks.storedComments, isLoading: false, isError: false }],
    useUtils: () => ({
      annotation: {
        getByTraceId: { invalidate: vi.fn() },
        getByTraceIds: { invalidate: vi.fn() },
      },
      traceEditOverlay: { getByTraceId: { invalidate: vi.fn() } },
    }),
    annotation: {
      getByTraceId: { useQuery: () => ({ data: [] }) },
      create: { useMutation: () => ({ mutate: vi.fn() }) },
      updateByTraceId: { useMutation: () => ({ mutate: vi.fn() }) },
      deleteById: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    annotationScore: {
      getAllActive: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    translate: {
      translate: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

import { RedactedField } from "../../../redacted-field";
import { IOViewer } from "../io-viewer";

const TRACE_ID = "trace-1";
const SPAN_ID = "span-7";

function comment(over: Partial<AnnotationByTrace> = {}): AnnotationByTrace {
  return {
    id: "annotation-1",
    traceId: TRACE_ID,
    comment: "the answer contradicts the policy",
    email: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    expectedOutput: null,
    isThumbsUp: null,
    scoreOptions: {},
    user: { id: "user-2", name: "Ada", image: null },
    anchorKind: "field",
    anchorId: SPAN_ID,
    anchorPath: "output",
    ...over,
  } as unknown as AnnotationByTrace;
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

beforeEach(() => {
  mocks.canManage = true;
  mocks.storedComments = [];
});

afterEach(cleanup);

describe("given a reader on a span's output", () => {
  /** @scenario "A comment action with room for a label carries one" */
  it("reads as a comment action in words", () => {
    render(
      <IOViewer
        label="Output"
        content="the shipment left this morning"
        mode="output"
        traceId={TRACE_ID}
        spanId={SPAN_ID}
      />,
      { wrapper },
    );

    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
  });

  /** @scenario "A comment action with room for a label carries one" */
  it("says how many comments the field carries once it has some", () => {
    mocks.storedComments = [comment()];

    render(
      <IOViewer
        label="Output"
        content="the shipment left this morning"
        mode="output"
        traceId={TRACE_ID}
        spanId={SPAN_ID}
      />,
      { wrapper },
    );

    expect(screen.getByRole("button", { name: "1 comment" })).toBeInTheDocument();
  });

  it("offers the correction the comment is asking for beside it", () => {
    render(
      <IOViewer
        label="Output"
        content="the shipment left this morning"
        mode="output"
        traceId={TRACE_ID}
        spanId={SPAN_ID}
      />,
      { wrapper },
    );

    expect(screen.getByRole("button", { name: "Suggest edit" })).toBeInTheDocument();
  });
});

describe("given a reader on the trace's own input", () => {
  /** @scenario "A suggestion on the trace's own input becomes the corrected trace input" */
  it("offers the correction the trace input carries alongside a comment", () => {
    render(
      <IOViewer label="Input" content="check on shipment 4417" traceId={TRACE_ID} />,
      { wrapper },
    );

    expect(screen.getByRole("button", { name: "Comment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest edit" })).toBeInTheDocument();
  });
});

describe("given a span whose input is hidden from the reader", () => {
  /** @scenario "A field hidden from the reader carries no comment action" */
  it("offers no comment action on it", () => {
    render(
      <RedactedField field="input" redacted visibleTo="Admins">
        <IOViewer
          label="Input"
          content="check on shipment 4417"
          traceId={TRACE_ID}
          spanId={SPAN_ID}
        />
      </RedactedField>,
      { wrapper },
    );

    expect(screen.getByText("Redacted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comment" })).not.toBeInTheDocument();
  });
});
