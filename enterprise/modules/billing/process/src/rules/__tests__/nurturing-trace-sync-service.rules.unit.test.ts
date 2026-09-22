/**
 * What a project's first and later traces tell Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerNoNurturingSink,
  registerNurturingSink,
  settle,
} from "../../services/__tests__/support/nurturing-harness.ts";
import {
  fireFirstTraceIntegrated,
  identifySubsequentTrace,
} from "../nurturing-trace-sync-service.rules.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => registerNoNurturingSink());

describe("fireFirstTraceIntegrated()", () => {
  /** @scenario "First trace identifies user with trace milestones" */
  it("identifies the user with has_traces, the sdk and the first-trace time", async () => {
    const sink = registerNurturingSink();

    fireFirstTraceIntegrated({
      userId: "user-1",
      projectId: "project-1",
      sdkLanguage: "python",
      sdkFramework: "openai",
      traceOccurredAt: "2026-09-05T10:00:00.000Z",
    });
    await settle();

    expect(sink.sentTo("/identify")[0]).toMatchObject({
      userId: "user-1",
      traits: {
        has_traces: true,
        sdk_language: "python",
        sdk_framework: "openai",
        first_trace_at: "2026-09-05T10:00:00.000Z",
      },
    });
  });

  /** @scenario "First trace fires first_trace_integrated event" */
  it("tracks first_trace_integrated with the sdk and the project", async () => {
    const sink = registerNurturingSink();

    fireFirstTraceIntegrated({
      userId: "user-1",
      projectId: "project-1",
      sdkLanguage: "typescript",
      sdkFramework: "vercel-ai",
      traceOccurredAt: "2026-09-05T10:00:00.000Z",
    });
    await settle();

    expect(sink.sentTo("/track")[0]).toMatchObject({
      userId: "user-1",
      event: "first_trace_integrated",
      properties: {
        sdk_language: "typescript",
        sdk_framework: "vercel-ai",
        project_id: "project-1",
      },
    });
  });

  it("silently skips without a configured sink", () => {
    registerNoNurturingSink();

    expect(() =>
      fireFirstTraceIntegrated({
        userId: "user-1",
        projectId: "project-1",
        sdkLanguage: "python",
        sdkFramework: "openai",
        traceOccurredAt: "2026-09-05T10:00:00.000Z",
      }),
    ).not.toThrow();
  });
});

describe("identifySubsequentTrace()", () => {
  // Covers the identify half of "Subsequent traces update count and
  // timestamp with debouncing"; the debounce itself is the subscriber's,
  // not this rule's — see the shared-file request for that piece.
  it("identifies the user with last_trace_at only", async () => {
    const sink = registerNurturingSink();

    identifySubsequentTrace({ userId: "user-1", traceOccurredAt: "2026-09-06T10:00:00.000Z" });
    await settle();

    expect(sink.sentTo("/identify")[0]).toMatchObject({
      userId: "user-1",
      traits: { last_trace_at: "2026-09-06T10:00:00.000Z" },
    });
    expect(sink.sentTo("/track")).toHaveLength(0);
  });
});
