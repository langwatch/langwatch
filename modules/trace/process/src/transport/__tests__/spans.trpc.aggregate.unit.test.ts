/**
 * @vitest-environment node
 * ADR-177 block F: a playground link reads the span through the proof narrowed to its member.
 * Ports main's spans.promptStudio.aggregate cases; the fence is span-storage.proof.integration.
 * Spec: specs/governance/aggregate-project.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { aggregateProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { createTraceAppHarness } from "../../app/__tests__/support/trace-app.harness.ts";
import type { TraceAppDependencies } from "../../app/trace.app.ts";
import { createInitState } from "../../eventing/__tests__/trace-summary-test.fixtures.ts";
import {
  derivePromptStudioSpan,
  promptStudioRowFromStoredSpan,
} from "../../features/legacy/rules/trace-legacy-prompt-studio-span.rules.ts";
import { TraceSummaryService } from "../../features/read/services/trace-summary-read.service.ts";
import { MemoryTraceSummaryRepository } from "../../repositories/memory/memory.trace-summary.repository.ts";
import type { StoredTraceSpan } from "../../repositories/span-storage.repository.ts";
import { spansTrpcTransport } from "../spans.trpc.ts";

type TestContext = { actor: { id: string } };

const AGGREGATE = "project-aggregate";
const MEMBER = "project-member";
const OUTSIDER = "project-outsider";
const PLAIN = "project-plain";
const OCCURRED_AT = 1_000;
const traceIdOf = (tenantId: string) => `trace-of-${tenantId}`;
const spanIdOf = (tenantId: string) => `llm-of-${tenantId}`;

/** An llm span naming its tenant, with stored strings a round trip would rewrite ("1.50"). */
function llmSpanOf(tenantId: string): StoredTraceSpan {
  return {
    spanId: spanIdOf(tenantId),
    traceId: traceIdOf(tenantId),
    parentSpanId: null,
    name: `llm of ${tenantId}`,
    spanAttributes: {
      "langwatch.span.type": "llm",
      "gen_ai.request.model": `model-of-${tenantId}`,
      "gen_ai.request.temperature": "1.50",
      "gen_ai.request.seed": "0042",
      "langwatch.input": JSON.stringify([
        { role: "system", content: `system of ${tenantId}` },
        { role: "user", content: `question of ${tenantId}` },
      ]),
      "langwatch.output": JSON.stringify([{ role: "assistant", content: `answer of ${tenantId}` }]),
    },
    startTimeUnixMs: OCCURRED_AT,
    endTimeUnixMs: OCCURRED_AT + 50,
    durationMs: 50,
    statusCode: 1,
    statusMessage: null,
  };
}

const TENANTS = [MEMBER, OUTSIDER, PLAIN];
const spansOf = (tenantId: string) => (TENANTS.includes(tenantId) ? [llmSpanOf(tenantId)] : []);

const aggregate = (): Authorization =>
  aggregateProof({ projectId: AGGREGATE, members: [{ projectId: MEMBER, from: 0 }] });

async function callerWith({ authorization }: { authorization: Authorization }) {
  const repository = MemoryTraceSummaryRepository.create();
  for (const tenantId of TENANTS) {
    await repository.upsert({ ...createInitState(), traceId: traceIdOf(tenantId) }, tenantId);
  }
  const app = createTraceAppHarness({
    traces: {
      summary: TraceSummaryService.create({ repository }),
      spans: createApiFixture<TraceAppDependencies["traces"]["spans"]>({
        findStoredSpansByTraceId: async ({ authorization: read, traceId }) =>
          projectIdsReadBy(read)
            .flatMap(spansOf)
            .filter((span) => span.traceId === traceId),
      }),
      // The span-only link reads the URL project's stored rows, as the legacy ClickHouse read does.
      read: createApiFixture<TraceAppDependencies["traces"]["read"]>({
        findSpanForPromptStudio: async ({ projectId, spanId }) =>
          derivePromptStudioSpan({
            rows: spansOf(projectId).map(promptStudioRowFromStoredSpan),
            spanId,
          }) ?? null,
      }),
    },
    protections: createApiFixture<NonNullable<TraceAppDependencies["protections"]>>({
      resolve: async () => ({ canSeeCapturedInput: true, canSeeCapturedOutput: true }),
    }),
  });

  const trpc = initTRPC.context<TestContext>().create();
  const base = trpcTestMembers<TestContext>();
  const members = trpcTestMembers<TestContext>({
    overrides: {
      authorization: {
        forRequest: (request) => ({
          ...base.authorization.forRequest(request),
          authorization: async () => authorization,
        }),
      },
    },
  });
  return createTrpcRuntime<TestContext>({ root: trpc, procedure: trpc.procedure, members })
    .mount(spansTrpcTransport, () => app)
    .createCaller({ actor: { id: "ana" } });
}

describe("Feature: opening a span in the playground carries the proof", () => {
  describe("given an aggregate with a member holding a trace with an LLM span", () => {
    describe("when ana opens that span in the playground from the aggregate's drawer", () => {
      /** @scenario "A member span opens in the playground under the aggregate" */
      it("loads the member's messages and model", async () => {
        const caller = await callerWith({ authorization: aggregate() });

        const span = await caller.getForPromptStudio({
          projectId: AGGREGATE,
          spanId: spanIdOf(MEMBER),
          traceId: traceIdOf(MEMBER),
          tenantId: MEMBER,
          occurredAtMs: OCCURRED_AT,
        });

        expect(span.traceId).toBe(traceIdOf(MEMBER));
        expect(span.llmConfig.model).toBe(`model-of-${MEMBER}`);
        expect(span.messages.map((message) => message.content)).toEqual([
          `system of ${MEMBER}`,
          `question of ${MEMBER}`,
          `answer of ${MEMBER}`,
        ]);
      });

      it("finds the member from the proof when the link names no member", async () => {
        const caller = await callerWith({ authorization: aggregate() });

        const span = await caller.getForPromptStudio({
          projectId: AGGREGATE,
          spanId: spanIdOf(MEMBER),
          traceId: traceIdOf(MEMBER),
        });

        expect(span.llmConfig.model).toBe(`model-of-${MEMBER}`);
      });

      it("answers a member the aggregate does not read as not found", async () => {
        const caller = await callerWith({ authorization: aggregate() });

        const refusal = await caller
          .getForPromptStudio({
            projectId: AGGREGATE,
            spanId: spanIdOf(OUTSIDER),
            traceId: traceIdOf(OUTSIDER),
            tenantId: OUTSIDER,
          })
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(refusal).toMatchObject({ cause: { code: "trace_not_found" } });
      });
    });
  });

  describe("given a plain project holding a trace with an LLM span", () => {
    describe("when ana opens that span from a link naming its trace, or only the span", () => {
      /** @scenario "A playground link on a plain project opens as before" */
      it("loads the same span either way", async () => {
        const caller = await callerWith({ authorization: ownProof({ projectId: PLAIN }) });

        const named = await caller.getForPromptStudio({
          projectId: PLAIN,
          spanId: spanIdOf(PLAIN),
          traceId: traceIdOf(PLAIN),
          occurredAtMs: OCCURRED_AT,
        });
        const spanOnly = await caller.getForPromptStudio({
          projectId: PLAIN,
          spanId: spanIdOf(PLAIN),
        });

        expect(named.llmConfig.model).toBe(`model-of-${PLAIN}`);
        expect(named.llmConfig.temperature).toBe("1.50");
        expect(named.llmConfig.seed).toBe("0042");
        expect(named).toEqual(spanOnly);
      });
    });
  });
});
