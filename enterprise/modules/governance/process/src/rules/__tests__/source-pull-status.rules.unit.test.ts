// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { sourcePullStatus } from "../source-pull-status.rules.ts";

const failed = (error: string, code: string | null = null) => ({
  LastRunAt: Date.UTC(2026, 0, 2),
  LastRunOutcome: "failed",
  LastRunError: error,
  LastRunErrorCode: code,
});

describe("sourcePullStatus", () => {
  it("answers unknowns for a source that never ran", () => {
    expect(sourcePullStatus({ sourceType: "otel_generic", cursor: null, pullRun: null })).toEqual({
      lastRunAt: null,
      outcome: null,
      error: null,
      backfillThrough: null,
      hasMore: null,
    });
  });

  it("names a rate limit without echoing the upstream body", () => {
    const status = sourcePullStatus({
      sourceType: "openai_admin",
      cursor: null,
      pullRun: failed("HTTP 429 from api.openai.com: secret-bearing body"),
    });
    expect(status.error).toBe("The provider's request limit was reached.");
    expect(status.lastRunAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("shows a refusal as written, since only we write that sentence", () => {
    const status = sourcePullStatus({
      sourceType: "otel_generic",
      cursor: null,
      pullRun: failed("This source is disabled.", "pull_refused"),
    });
    expect(status.error).toBe("This source is disabled.");
  });

  it("reads a billing cursor's watermark while more pages remain", () => {
    const cursor = JSON.stringify({
      startingAt: "2026-01-01T00:00:00Z",
      watermark: "2026-01-05T00:00:00Z",
      page: "next",
    });
    expect(
      sourcePullStatus({ sourceType: "anthropic_admin", cursor, pullRun: null }),
    ).toMatchObject({
      backfillThrough: "2026-01-05T00:00:00.000Z",
      hasMore: true,
    });
  });

  it("answers unknown progress for an unreadable cursor", () => {
    expect(
      sourcePullStatus({ sourceType: "openai_admin", cursor: "{not json", pullRun: null }),
    ).toMatchObject({ backfillThrough: null, hasMore: null });
  });
});
