import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { CodingAgentApi, CodingAgentTranscript } from "@langwatch/coding-agent-contract";
import { codingAgentSessionFixture } from "@langwatch/coding-agent-contract/testing";
/**
 * @vitest-environment node
 * The drawer's coding-agent reads, moved from `traces.*` to `codingAgents.*`.
 * @see modules/coding-agent/specs/coding-agent-trace-reads.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { codingAgentTrpcTransport } from "../coding-agent.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT_ID = "project-1";
const TRACE_ID = "trace-1";
const SESSION = codingAgentSessionFixture({ traceIds: [TRACE_ID] });
const TRANSCRIPT: CodingAgentTranscript = {
  agent: "claude_code",
  sessionId: "session-1",
  entries: [],
  totals: { modelCalls: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
  subAgents: [],
};

function permittingRuntime() {
  const trpc = initTRPC.context<TestContext>().create();
  const members = trpcTestMembers<TestContext>();

  return createTrpcRuntime<TestContext>({ root: trpc, procedure: trpc.procedure, members });
}

function harness(session: typeof SESSION | null) {
  const findSessionForTraceForViewer = vi.fn<CodingAgentApi["findSessionForTraceForViewer"]>(
    async () => session,
  );
  const readTranscriptForViewer = vi.fn<CodingAgentApi["readTranscriptForViewer"]>(
    async () => TRANSCRIPT,
  );
  const app = createApiFixture<CodingAgentApi>({
    findSessionForTraceForViewer,
    readTranscriptForViewer,
  });
  const router = permittingRuntime().mount(codingAgentTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "viewer-1" } }),
    findSessionForTraceForViewer,
    readTranscriptForViewer,
  };
}

describe("codingAgents.session", () => {
  describe("given a trace that belongs to a coding-agent session", () => {
    /** @scenario "The drawer reads the coding-agent session a trace belongs to" */
    it("reads the session for the signed-in viewer and their authorization, and answers it unchanged", async () => {
      const { caller, findSessionForTraceForViewer } = harness(SESSION);

      const answer = await caller.session({ projectId: PROJECT_ID, traceId: TRACE_ID });

      expect(answer).toEqual(SESSION);
      expect(findSessionForTraceForViewer).toHaveBeenCalledWith(
        {
          projectId: PROJECT_ID,
          traceId: TRACE_ID,
          authorization: expect.objectContaining({ principal: { id: "viewer-1", type: "user" } }),
        },
        expect.objectContaining({ id: "viewer-1" }),
      );
    });
  });

  describe("given a trace coding-agent knows no session for", () => {
    /** @scenario "A trace outside any coding-agent session reads no session" */
    it("answers null", async () => {
      const { caller } = harness(null);

      await expect(
        caller.session({ projectId: PROJECT_ID, traceId: TRACE_ID }),
      ).resolves.toBeNull();
    });
  });
});

describe("codingAgents.transcript", () => {
  describe("given a signed-in viewer and a partition hint", () => {
    /** @scenario "The drawer's transcript is read for the signed-in viewer" */
    it("reads the transcript for that viewer, their authorization, trace and hint, and answers it unchanged", async () => {
      const { caller, readTranscriptForViewer } = harness(null);

      const answer = await caller.transcript({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        occurredAtMs: 1_700_000_000_000,
      });

      expect(answer).toEqual(TRANSCRIPT);
      expect(readTranscriptForViewer).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        occurredAtMs: 1_700_000_000_000,
        viewerUserId: "viewer-1",
        authorization: expect.objectContaining({ principal: { id: "viewer-1", type: "user" } }),
      });
    });
  });
});
