/**
 * @vitest-environment node
 *
 * The single-span read's miss path.
 *
 * `selectedSpanId` is read straight off the `drawer.span` URL param
 * (`features/traces-v2/stores/drawerStore.ts`), so any shared or bookmarked
 * link can ask for a span id that resolves to nothing — and so can a span the
 * viewer's visibility window hides, which `SpanStorageService.getSpanById`
 * reports as the same `null`. The read must name THAT failure: the trace is
 * still there, only the span is gone.
 *
 * App-layer reads are stubbed (the enrichment.integration pattern); session +
 * RBAC run against the real test database.
 */
import { HandledError } from "@langwatch/handled-error";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const PROJECT_ID = "test-project-id";
const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const MISSING_SPAN_ID = "0000000000000000";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getSpanById: vi.fn(),
    getSpanEvents: vi.fn(),
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: {
      spans: {
        getSpanById: mocks.getSpanById,
        getSpanEvents: mocks.getSpanEvents,
        getSpanSummaryByTraceId: vi.fn().mockResolvedValue([]),
        getSpansByTraceId: vi.fn().mockResolvedValue([]),
      },
      logRecords: { getLogsByTraceId: vi.fn().mockResolvedValue([]) },
    },
  }),
}));

vi.mock("../../utils", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getVisibilityCutoffMsForProject: vi.fn().mockResolvedValue(null),
    getUserProtectionsForProject: vi.fn().mockResolvedValue({
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    }),
  };
});

describe("tracesV2.spanDetail", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const user = await getTestUser();
    const ctx = createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    });
    caller = appRouter.createCaller(ctx);
  });

  describe("given a span id that resolves to no span", () => {
    describe("when the drawer asks for its detail", () => {
      /** @scenario "A span that cannot be found is not reported as a missing trace" */
      it("reports the span as missing, not the trace", async () => {
        mocks.getSpanById.mockResolvedValue(null);
        mocks.getSpanEvents.mockResolvedValue([]);

        const error = await caller.tracesV2
          .spanDetail({
            projectId: PROJECT_ID,
            traceId: TRACE_ID,
            spanId: MISSING_SPAN_ID,
          })
          .then(
            () => {
              throw new Error("spanDetail resolved for a span that is absent");
            },
            (raised: unknown) => raised,
          );

        const handled = (error as { cause?: unknown }).cause;
        expect(HandledError.isHandled(handled)).toBe(true);
        // `code` rather than the message: the wire message for a handled error
        // is the code slug, and the words the customer reads come from the
        // presentation registry keyed by this.
        expect((handled as HandledError).code).toBe("span_not_found");
      });

      /** @scenario "The refusal names the span it could not find" */
      it("carries the span id under spanId, leaving the trace slot clear", async () => {
        mocks.getSpanById.mockResolvedValue(null);
        mocks.getSpanEvents.mockResolvedValue([]);

        const error = await caller.tracesV2
          .spanDetail({
            projectId: PROJECT_ID,
            traceId: TRACE_ID,
            spanId: MISSING_SPAN_ID,
          })
          .then(
            () => {
              throw new Error("spanDetail resolved for a span that is absent");
            },
            (raised: unknown) => raised,
          );

        const meta = ((error as { cause?: HandledError }).cause?.meta ??
          {}) as Record<string, unknown>;
        expect(meta.spanId).toBe(MISSING_SPAN_ID);
        // The defect this guards: the miss used to raise `trace_not_found`
        // with the SPAN id sitting in `meta.traceId`, telling the reader a
        // trace that is plainly on screen had gone away.
        expect(meta.traceId).toBeUndefined();
      });
    });
  });
});
