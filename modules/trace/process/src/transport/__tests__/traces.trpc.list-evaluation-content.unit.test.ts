import { createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * @vitest-environment node
 * @unit
 * The list door gates each row's evaluation error text by the viewer's protections.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { Protections, TraceApi, TraceListPage } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { mapToTraceListItem } from "../../rules/trace-list-row.rules.ts";
import { listedRow } from "../../services/__tests__/support/trace-list-rows.support.ts";
import { tracesTrpcTransport } from "../traces.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const VIEWER = { id: "viewer-1" };
const ERROR_TEXT = "free_budget_exhausted: spent";
const NOW = 1_700_000_000_000;

function page(): TraceListPage {
  // The fields the list mapper reads; the row's last-used prompt is read off the summary.
  const item = mapToTraceListItem({
    ...listedRow({ tenantId: PROJECT_ID, traceId: "trace-1", occurredAt: NOW }),
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
  } as never);
  return {
    items: [
      {
        ...item,
        evaluations: [
          {
            evaluationId: "eval-1",
            evaluatorId: "monitor-1",
            evaluatorType: "test/evaluator",
            evaluatorName: "Test Evaluator",
            traceId: "trace-1",
            isGuardrail: false,
            status: "error",
            score: null,
            passed: null,
            label: null,
            error: ERROR_TEXT,
          },
        ],
      },
    ],
    totalHits: 1,
    nextCursor: null,
  };
}

async function listedErrorsFor(protections: Protections) {
  const app = createApiFixture<TraceApi>({
    resolveViewerProtections: vi.fn(async () => protections),
    compileExplorerTraceFilter: vi.fn(() => ({ sql: "", params: {} })),
    findExplorerEvalRuns: vi.fn(async () => []),
    readTraceList: vi.fn(async () => page()),
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>(),
  }).mount(tracesTrpcTransport, () => app);

  const listed = await router.createCaller({ actor: VIEWER }).list({
    projectId: PROJECT_ID,
    timeRange: { from: NOW - 1_000, to: NOW + 1_000 },
    sort: { columnId: "timestamp", direction: "desc" },
  });
  return listed.items.flatMap((item) => item.evaluations.map((e) => e.error));
}

describe("given a trace list row with an evaluator whose run errored", () => {
  describe("when a viewer who may not read captured input reads the list", () => {
    /** @scenario "A viewer who may not read captured content sees no error text on a chip" */
    it("carries an empty error text, as the trace drawer's runs do", async () => {
      expect(
        await listedErrorsFor({ canSeeCapturedInput: false, canSeeCapturedOutput: true }),
      ).toEqual([""]);
    });
  });

  describe("when a viewer who may read captured content reads the list", () => {
    it("carries the error text", async () => {
      expect(
        await listedErrorsFor({ canSeeCapturedInput: true, canSeeCapturedOutput: true }),
      ).toEqual([ERROR_TEXT]);
    });
  });
});
