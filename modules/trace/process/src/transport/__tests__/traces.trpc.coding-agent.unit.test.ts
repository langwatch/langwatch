/**
 * @vitest-environment node
 * The drawer's coding-agent reads at main's names, bodies and permission.
 * @see modules/trace/specs/trace-drawer-coding-agent-reads.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { tracesTrpcTransport } from "../traces.trpc.ts";
import { accessDeclaredBy, createTestTrpcRuntime } from "./support/trpc-harness.ts";

const PROJECT_ID = "project-1";
const TRACE_ID = "trace-1";
const SESSION = { sessionId: "session-1", agent: "claude_code", traceIds: [TRACE_ID] };
const TRANSCRIPT = { agent: "claude_code", sessionId: "session-1", entries: [], totals: {} };

function harness(session: unknown) {
  const readCodingAgentSession = vi.fn<TraceApi["readCodingAgentSession"]>(async () => session);
  const readCodingAgentTranscript = vi.fn<TraceApi["readCodingAgentTranscript"]>(
    async () => TRANSCRIPT,
  );
  const app = createApiFixture<TraceApi>({ readCodingAgentSession, readCodingAgentTranscript });
  const router = createTestTrpcRuntime().mount(tracesTrpcTransport, () => app);

  return {
    caller: router.createCaller({ actor: { id: "viewer-1" } }),
    readCodingAgentSession,
    readCodingAgentTranscript,
  };
}

describe("traces.codingAgentSession", () => {
  describe("given a trace that belongs to a coding-agent session", () => {
    /** @scenario "The drawer reads the coding-agent session a trace belongs to" */
    it("answers the session coding-agent reads for the trace, unchanged", async () => {
      const { caller, readCodingAgentSession } = harness(SESSION);

      const answer = await caller.codingAgentSession({ projectId: PROJECT_ID, traceId: TRACE_ID });

      expect(answer).toEqual(SESSION);
      expect(readCodingAgentSession).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
      });
    });
  });

  describe("given a trace coding-agent knows no session for", () => {
    /** @scenario "A trace outside any coding-agent session reads no session" */
    it("answers null", async () => {
      const { caller } = harness(null);

      await expect(
        caller.codingAgentSession({ projectId: PROJECT_ID, traceId: TRACE_ID }),
      ).resolves.toBeNull();
    });
  });
});

describe("traces.codingAgentTranscript", () => {
  describe("given a signed-in viewer and a partition hint", () => {
    /** @scenario "The drawer's transcript is read for the signed-in viewer" */
    it("reads the transcript for that viewer, trace and hint, and answers it unchanged", async () => {
      const { caller, readCodingAgentTranscript } = harness(null);

      const answer = await caller.codingAgentTranscript({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        occurredAtMs: 1_700_000_000_000,
      });

      expect(answer).toEqual(TRANSCRIPT);
      expect(readCodingAgentTranscript).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        traceId: TRACE_ID,
        occurredAtMs: 1_700_000_000_000,
        viewerUserId: "viewer-1",
      });
    });
  });
});

describe("given the traces namespace declaration", () => {
  /** @scenario "The coding-agent reads need permission to view traces" */
  it("asks for traces:view on both coding-agent reads", () => {
    const access = accessDeclaredBy(tracesTrpcTransport);

    expect(access["traces.codingAgentSession"]).toBe("traces:view");
    expect(access["traces.codingAgentTranscript"]).toBe("traces:view");
  });
});
