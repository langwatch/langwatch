// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The puller worker's conversation-routing handoff (ADR-088 v7, Decisions
 * 8, 9, 13), at the module boundary — same mocking shape as
 * pullerWorker.dispatch.unit.test.ts.
 *
 * The redaction assertion is the load-bearing one: the worker must pass the
 * destination project id as the TENANT and the plain route default as the
 * level, because per-project privacy policy is enforced by the pipeline's
 * own tenant lookup — a worker-computed level would have unchecked
 * authority at the default tier (red-team finding, Decision 13).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import type { NormalizedPullEvent } from "../pullerAdapter";

const projectFindFirst = vi.fn();
const handleOtlpTraceRequest = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: { project: { findFirst: projectFindFirst } },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    traces: { collection: { handleOtlpTraceRequest } },
  }),
}));

// The worker imports the feature-flag service, whose transitive `langwatch`
// SDK import is irrelevant here — same boundary the dispatch test cuts.
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: vi.fn().mockResolvedValue(false) },
}));

// The worker module pulls in the whole app graph; import after the mocks.
const { routeConversationsToTraceDestination } = await import(
  "../pullerWorker"
);

const SOURCE = {
  id: "source-1",
  sourceType: "databricks_genie",
  organizationId: "org-1",
  teamId: null,
  traceProjectId: "proj-dest",
};

function genieEvent(): NormalizedPullEvent {
  return {
    source_event_id: "msg-1",
    event_timestamp: "2026-08-20T10:00:00.000Z",
    actor: "analyst@acme.example",
    action: "genie_query",
    target: "Sales space",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify({
      message_id: "msg-1",
      conversation_id: "conv-1",
      content: "Which region sold most?",
      status: "COMPLETED",
      created_timestamp: 1755684000,
      attachments: [{ text: { content: "EMEA.", purpose: "ANSWER" } }],
    }),
    extra: { conversationId: "conv-1", messageId: "msg-1" },
  };
}

beforeEach(() => {
  projectFindFirst.mockReset();
  handleOtlpTraceRequest.mockReset();
  handleOtlpTraceRequest.mockResolvedValue({ rejectedSpans: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("given a source with a live trace destination", () => {
  beforeEach(() => {
    projectFindFirst.mockResolvedValue({ id: "proj-dest" });
  });

  it("routes through the trace door with the destination as tenant and the ROUTE DEFAULT redaction level", async () => {
    await routeConversationsToTraceDestination({
      events: [genieEvent()],
      source: SOURCE,
    });

    expect(handleOtlpTraceRequest).toHaveBeenCalledTimes(1);
    const [tenantId, request, level] = handleOtlpTraceRequest.mock.calls[0]!;
    expect(tenantId).toBe("proj-dest");
    expect(level).toBe(DEFAULT_PII_REDACTION_LEVEL);
    expect(
      request.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.length,
    ).toBeGreaterThan(0);
  });

  it("re-checks the destination against the source's own org, ignoring archived projects", async () => {
    await routeConversationsToTraceDestination({
      events: [genieEvent()],
      source: SOURCE,
    });
    expect(projectFindFirst).toHaveBeenCalledWith({
      where: {
        id: "proj-dest",
        archivedAt: null,
        team: { organizationId: "org-1" },
      },
      select: { id: true },
    });
  });

  it("routes nothing when the batch carries no conversation-bearing events", async () => {
    await routeConversationsToTraceDestination({
      events: [{ ...genieEvent(), action: "usage_bucket" }],
      source: SOURCE,
    });
    expect(handleOtlpTraceRequest).not.toHaveBeenCalled();
    expect(projectFindFirst).not.toHaveBeenCalled();
  });
});

describe("given a source without a destination", () => {
  it("never touches the trace door — routing is off by default", async () => {
    await routeConversationsToTraceDestination({
      events: [genieEvent()],
      source: { ...SOURCE, traceProjectId: null },
    });
    expect(handleOtlpTraceRequest).not.toHaveBeenCalled();
  });
});

describe("given a destination that is archived, deleted, or another org's", () => {
  it("skips routing instead of failing the run or landing elsewhere", async () => {
    projectFindFirst.mockResolvedValue(null);
    await routeConversationsToTraceDestination({
      events: [genieEvent()],
      source: SOURCE,
    });
    expect(handleOtlpTraceRequest).not.toHaveBeenCalled();
  });
});

/**
 * The trace door reports per-span outcomes as counters on a RESOLVED promise,
 * so an outage on the far side of it looks like success to a caller that only
 * reads the return value. For a caller with a durable cursor that is data
 * loss: the audit row lands, the cursor advances, and the conversation never
 * reaches the explorer with nothing left to retry it.
 */
describe("given the trace door could not dispatch the spans", () => {
  beforeEach(() => {
    projectFindFirst.mockResolvedValue({ id: "proj-dest" });
  });

  describe("when the failure is a dispatch failure (queue or Redis down)", () => {
    it("fails the run so the cursor holds and the whole window is re-sent", async () => {
      handleOtlpTraceRequest.mockResolvedValue({
        rejectedSpans: 2,
        ingestionFailures: 2,
        errorMessage: "Connection is closed",
      });

      await expect(
        routeConversationsToTraceDestination({
          events: [genieEvent()],
          source: SOURCE,
        }),
      ).rejects.toThrow(/failed to dispatch 2 span\(s\).*Connection is closed/);
    });
  });

  describe("when the rejections are permanent drops", () => {
    it("completes the run — a span past the 31-day door or failing the schema is no better on a retry", async () => {
      handleOtlpTraceRequest.mockResolvedValue({
        rejectedSpans: 2,
        ingestionFailures: 0,
        errorMessage: "span start time is more than 31 days in the past",
      });

      await expect(
        routeConversationsToTraceDestination({
          events: [genieEvent()],
          source: SOURCE,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
