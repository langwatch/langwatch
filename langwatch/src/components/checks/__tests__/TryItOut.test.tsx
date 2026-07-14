/**
 * @vitest-environment jsdom
 *
 * Pins the precondition-preview seam between `api.traces.getSampleTraces`
 * and the client-side helpers (`checkEvaluatorRequiredFields`,
 * `buildPreconditionTraceDataFromTrace`, `evaluatePreconditions`).
 *
 * After the ES removal, TryItOut feeds raw `trace.spans` from the endpoint
 * straight into those helpers (no client-side transform in between). These
 * tests execute the real helpers against endpoint-shaped fixtures so a span
 * shape drift (e.g. rag spans no longer carrying `contexts`) fails here
 * instead of silently marking every sample trace as failing preconditions.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Span } from "~/server/tracer/types";
import type { RouterOutputs } from "~/utils/api";
import { TryItOut } from "../TryItOut";
import type { CheckConfigFormData } from "../CheckConfigForm";

type SampleTraces = RouterOutputs["traces"]["getSampleTraces"];

const sampleTracesHolder = vi.hoisted(() => ({
  data: [] as unknown[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getSampleTraces: {
        useQuery: () => ({
          data: sampleTracesHolder.data,
          isLoading: false,
          isFetched: true,
        }),
      },
    },
    evaluations: {
      runEvaluation: {
        useMutation: () => ({ mutate: vi.fn() }),
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
    projectId: "test-project",
  }),
}));

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: {
      projectId: "test-project",
      filters: {},
      startDate: 0,
      endDate: 0,
    },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({
    isRedacted: false,
    isLoading: false,
    visibleTo: null,
  }),
}));

vi.mock("~/components/PeriodSelector", () => ({
  PeriodSelector: () => null,
  usePeriodSelector: () => ({
    period: { startDate: new Date(0), endDate: new Date(0) },
    mode: "relative",
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
  }),
}));

vi.mock("~/components/filters/FilterSidebar", () => ({
  FilterSidebar: () => null,
}));

vi.mock("~/components/filters/FilterToggle", () => ({
  FilterToggle: () => null,
}));

/** Spans typed strictly against the tracer schema — the seam under test. */
const ragSpanWithContexts: Span[] = [
  {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "rag",
    contexts: [
      { document_id: "doc-1", chunk_id: "chunk-1", content: "Paris is the capital of France." },
    ],
    timestamps: { started_at: 1700000000000, finished_at: 1700000001000 },
  },
  {
    span_id: "span-2",
    trace_id: "trace-1",
    type: "llm",
    model: "gpt-5-mini",
    timestamps: { started_at: 1700000001000, finished_at: 1700000002000 },
  },
];

const llmOnlySpans: Span[] = [
  {
    span_id: "span-1",
    trace_id: "trace-2",
    type: "llm",
    model: "gpt-5-mini",
    timestamps: { started_at: 1700000000000, finished_at: 1700000001000 },
  },
];

const buildSampleTrace = ({
  traceId,
  spans,
  passesPreconditions,
}: {
  traceId: string;
  spans: Span[];
  passesPreconditions: boolean;
}) =>
  ({
    trace_id: traceId,
    project_id: "test-project",
    metadata: {},
    timestamps: {
      started_at: 1700000000000,
      inserted_at: 1700000002000,
      updated_at: 1700000002000,
    },
    input: { value: "What is the capital of France?" },
    output: { value: "Paris." },
    metrics: {},
    spans,
    passesPreconditions,
  }) as unknown as SampleTraces[number];

function TryItOutHarness() {
  const form = useForm<CheckConfigFormData>({
    defaultValues: {
      name: "My check",
      // ragas/faithfulness requires `contexts`, so a rag span with textual
      // contexts must be present for the sample to pass preconditions.
      checkType: "ragas/faithfulness",
      sample: 1,
      preconditions: [],
      settings: {},
    } as Partial<CheckConfigFormData> as CheckConfigFormData,
  });

  return (
    <ChakraProvider value={defaultSystem}>
      <TryItOut form={form} />
    </ChakraProvider>
  );
}

describe("TryItOut precondition preview", () => {
  afterEach(() => {
    cleanup();
    sampleTracesHolder.data = [];
  });

  describe("given a contexts-requiring evaluator (ragas/faithfulness)", () => {
    describe("when the endpoint returns a trace with a rag span carrying contexts", () => {
      it("marks the sample as ready to run", async () => {
        sampleTracesHolder.data = [
          buildSampleTrace({
            traceId: "trace-1",
            spans: ragSpanWithContexts,
            passesPreconditions: true,
          }),
        ];

        render(<TryItOutHarness />);

        // The first (and only) sample passes the client-side precondition
        // re-check, so it is queued as the first trace to run.
        expect(await screen.findByText("Waiting to run")).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /run on samples/i }),
        ).toBeEnabled();
      });
    });

    describe("when the endpoint returns a trace without rag contexts", () => {
      it("marks the sample as failing preconditions", async () => {
        sampleTracesHolder.data = [
          buildSampleTrace({
            traceId: "trace-2",
            spans: llmOnlySpans,
            passesPreconditions: false,
          }),
        ];

        render(<TryItOutHarness />);

        expect(
          await screen.findByText("What is the capital of France?"),
        ).toBeInTheDocument();
        expect(screen.queryByText("Waiting to run")).not.toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /run on samples/i }),
        ).toBeDisabled();
      });
    });
  });
});
