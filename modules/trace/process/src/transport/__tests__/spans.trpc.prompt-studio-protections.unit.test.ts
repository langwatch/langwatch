/**
 * @vitest-environment node
 * #8549: both prompt-studio reads apply the drawer's content protections and
 * the plan's visibility window, or refuse the content.
 * Spec: specs/traces-v2/prompt-studio-span-protections.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import type { Protections } from "@langwatch/trace-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { createTraceAppHarness } from "../../app/__tests__/support/trace-app.harness.ts";
import type { TraceAppDependencies } from "../../app/trace.app.ts";
import { createInitState } from "../../eventing/__tests__/trace-summary-test.fixtures.ts";
import {
  derivePromptStudioSpan,
  promptStudioRowFromStoredSpan,
} from "../../features/legacy/rules/trace-legacy-prompt-studio-span.rules.ts";
import { redactPromptStudioRows } from "../../features/legacy/rules/trace-prompt-studio-protection.rules.ts";
import { TraceSummaryService } from "../../features/read/services/trace-summary-read.service.ts";
import { MemoryTraceSummaryRepository } from "../../repositories/memory/memory.trace-summary.repository.ts";
import type { StoredTraceSpan } from "../../repositories/span-storage.repository.ts";
import { spansTrpcTransport } from "../spans.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT = "project-1";
const TRACE_ID = "trace-1";
const SPAN_ID = "llm-1";
const STARTED_AT = 1_000_000;
const FULL: Protections = { canSeeCapturedInput: true, canSeeCapturedOutput: true };

const llmSpan: StoredTraceSpan = {
  spanId: SPAN_ID,
  traceId: TRACE_ID,
  parentSpanId: null,
  name: "llm",
  spanAttributes: {
    "langwatch.span.type": "llm",
    "gen_ai.request.model": "gpt-test",
    "langwatch.input": JSON.stringify([
      { role: "system", content: "secret system prompt" },
      { role: "user", content: "secret question" },
    ]),
    "langwatch.output": JSON.stringify([{ role: "assistant", content: "secret answer" }]),
    "langwatch.prompt.id": "team/sample-prompt:3",
    "langwatch.prompt.variables": '{"type":"json","value":{"customer":"Alice"}}',
  },
  startTimeUnixMs: STARTED_AT,
  endTimeUnixMs: STARTED_AT + 50,
  durationMs: 50,
  statusCode: 1,
  statusMessage: null,
};

async function callerWith(protections: Protections) {
  const reads: string[] = [];
  const summaries = MemoryTraceSummaryRepository.create();
  await summaries.upsert({ ...createInitState(), traceId: TRACE_ID }, PROJECT);
  const app = createTraceAppHarness({
    traces: {
      summary: TraceSummaryService.create({ repository: summaries }),
      spans: createApiFixture<TraceAppDependencies["traces"]["spans"]>({
        findStoredSpansByTraceId: async () => {
          reads.push("trace-named");
          return [llmSpan];
        },
      }),
      // As the ClickHouse read does: attribute policies apply to the rows before deriving.
      read: createApiFixture<TraceAppDependencies["traces"]["read"]>({
        findSpanForPromptStudio: async ({ spanId, protections: viewer }) => {
          reads.push("span-only");
          return (
            derivePromptStudioSpan({
              rows: redactPromptStudioRows([promptStudioRowFromStoredSpan(llmSpan)], viewer),
              spanId,
            }) ?? null
          );
        },
      }),
    },
    protections: createApiFixture<NonNullable<TraceAppDependencies["protections"]>>({
      resolve: async () => protections,
    }),
  });

  const trpc = initTRPC.context<TestContext>().create();
  const base = trpcTestMembers<TestContext>();
  const members = trpcTestMembers<TestContext>({
    overrides: {
      authorization: {
        forRequest: (request) => ({
          ...base.authorization.forRequest(request),
          authorization: async () => ownProof({ projectId: PROJECT }),
        }),
      },
    },
  });
  const caller = createTrpcRuntime<TestContext>({ root: trpc, procedure: trpc.procedure, members })
    .mount(spansTrpcTransport, () => app)
    .createCaller({ actor: { id: "ana" } });
  return { caller, reads };
}

const LINKS = {
  "a link naming the trace": { projectId: PROJECT, spanId: SPAN_ID, traceId: TRACE_ID },
  "a link naming only the span": { projectId: PROJECT, spanId: SPAN_ID },
} as const;

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("Feature: the playground reads a span through the viewer's protections", () => {
  describe.each(Object.entries(LINKS))("given %s", (_label, link) => {
    describe("when the viewer may not read captured input", () => {
      /** @scenario "A viewer who may not read captured input is refused the span" */
      it("refuses the span without reading it", async () => {
        const { caller, reads } = await callerWith({ ...FULL, canSeeCapturedInput: false });

        const refusal = await refusalOf(caller.getForPromptStudio(link));

        expect(refusal).toMatchObject({
          cause: { code: "span_content_withheld", meta: { reason: "content_hidden" } },
        });
        expect(reads).toEqual([]);
      });
    });

    describe("when a privacy rule hides system instructions from the viewer", () => {
      /** @scenario "A viewer a privacy rule hides any content category from is refused the span" */
      it("refuses the span", async () => {
        const visible = { canSee: true, restrictVisibleTo: null };
        const { caller } = await callerWith({
          ...FULL,
          contentCategories: {
            input: visible,
            output: visible,
            system: { canSee: false, restrictVisibleTo: "Admins" },
            tools: visible,
          },
        });

        const refusal = await refusalOf(caller.getForPromptStudio(link));

        expect(refusal).toMatchObject({ cause: { code: "span_content_withheld" } });
      });
    });

    describe("when the span started before the plan's visibility window", () => {
      /** @scenario "A span older than the plan's visibility window is refused" */
      it("refuses the span", async () => {
        const { caller } = await callerWith({ ...FULL, visibilityCutoffMs: STARTED_AT + 1 });

        const refusal = await refusalOf(caller.getForPromptStudio(link));

        expect(refusal).toMatchObject({
          cause: {
            code: "span_content_withheld",
            meta: { reason: "outside_visibility_window" },
          },
        });
      });
    });

    describe("when the span started inside the plan's visibility window", () => {
      /** @scenario "A span inside the plan's visibility window opens in full" */
      it("opens the span with its messages", async () => {
        const { caller } = await callerWith({ ...FULL, visibilityCutoffMs: STARTED_AT });

        const span = await caller.getForPromptStudio(link);

        expect(span.messages.map((message) => message.content)).toEqual([
          "secret system prompt",
          "secret question",
          "secret answer",
        ]);
        expect(span.promptVariables).toEqual({ customer: "Alice" });
      });
    });

    describe("when an attribute policy hides the prompt variables from the viewer", () => {
      /** @scenario "An attribute a policy hides from the viewer is not read into the prompt" */
      it("opens the span without the hidden values", async () => {
        const { caller } = await callerWith({
          ...FULL,
          hiddenAttributes: [{ pattern: "langwatch.prompt.variables", visibleTo: "Admins" }],
        });

        const span = await caller.getForPromptStudio(link);

        expect(JSON.stringify(span)).not.toContain("Alice");
        expect(span.llmConfig.model).toBe("gpt-test");
      });
    });
  });
});
