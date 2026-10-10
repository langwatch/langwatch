import { databricksGeniePullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  configuredSinceMs,
  cursorSchema,
  encodeGenieCursor,
  nextCursor,
} from "../../features/databricks-genie/rules/databricks-genie-cursor.rules.ts";
import type { SweepResult } from "../../features/databricks-genie/rules/databricks-genie-sweep.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const previous = cursorSchema.parse({ sinceMs: 1_000_000 });
const finished: SweepResult = {
  events: [],
  complete: true,
  resumeSpaceId: null,
  resumeConversationId: null,
  hadGap: false,
  oldestPendingMs: null,
  spaceSetFingerprint: "a",
};
const run = {
  previous,
  sweep: finished,
  sweepStartedAtMs: 10_000_000,
  pricedThroughMs: null,
  paidBillWindow: null,
  nowMs: 20_000_000,
};

describe("encodeGenieCursor()", () => {
  it("writes every field, in the order a stored cursor has always had", () => {
    expect(encodeGenieCursor(cursorSchema.parse({ sinceMs: 5 }))).toBe(
      '{"sinceMs":5,"spaceId":null,"conversationId":null,"sweepHadGap":false,' +
        '"spaceSetFingerprint":null,"sweepOldestPendingMs":null,"sweepStartedAtMs":null,' +
        '"costHeldSinceMs":null,"paidBillReadThroughMs":null,"paidBillHeldSinceMs":null}',
    );
  });
});

describe("configuredSinceMs()", () => {
  const config = databricksGeniePullConfigSchema.parse({
    adapter: "databricks_genie",
    workspaceUrl: "https://workspace.example.test",
  });

  it("starts at the configured instant", () => {
    expect(
      configuredSinceMs({ config: { ...config, startingAt: "2026-01-01T00:00:00Z" }, nowMs: 0 }),
    ).toBe(Date.UTC(2026, 0, 1));
  });

  it("reads the last thirty days when no instant is configured", () => {
    expect(configuredSinceMs({ config, nowMs: 40 * DAY_MS })).toBe(10 * DAY_MS);
  });
});

describe("nextCursor()", () => {
  it("moves a finished sweep's watermark to five minutes before it began and starts clean", () => {
    expect(encodeGenieCursor(nextCursor(run))).toBe(
      '{"sinceMs":9700000,"spaceId":null,"conversationId":null,"sweepHadGap":false,' +
        '"spaceSetFingerprint":null,"sweepOldestPendingMs":null,"sweepStartedAtMs":null,' +
        '"costHeldSinceMs":null,"paidBillReadThroughMs":null,"paidBillHeldSinceMs":null}',
    );
  });

  it("keeps an in-flight sweep's position, gap, anchor and pending ceiling, and holds the watermark", () => {
    const next = nextCursor({
      ...run,
      sweep: {
        ...finished,
        complete: false,
        resumeSpaceId: "s2",
        resumeConversationId: "c9",
        hadGap: true,
        oldestPendingMs: 5_000_000,
        spaceSetFingerprint: "fp",
      },
    });

    expect(next).toMatchObject({
      sinceMs: 1_000_000,
      spaceId: "s2",
      conversationId: "c9",
      sweepHadGap: true,
      spaceSetFingerprint: "fp",
      sweepOldestPendingMs: 5_000_000,
      sweepStartedAtMs: 10_000_000,
    });
  });

  it("stops just short of the oldest message still settling", () => {
    const sweep = { ...finished, oldestPendingMs: 8_000_000 };
    expect(nextCursor({ ...run, sweep }).sinceMs).toBe(7_999_999);
  });

  it("holds at the priced ceiling and stamps the hold, until the hold expires", () => {
    const held = nextCursor({ ...run, pricedThroughMs: 4_000_000 });
    const expiredAt = 1 + 7 * DAY_MS + 1;
    const expired = nextCursor({
      ...run,
      previous: { ...previous, costHeldSinceMs: 1 },
      pricedThroughMs: 4_000_000,
      nowMs: expiredAt,
    });

    expect(held).toMatchObject({ sinceMs: 4_000_000, costHeldSinceMs: 20_000_000 });
    expect(expired).toMatchObject({ sinceMs: 9_700_000, costHeldSinceMs: null });
  });

  it("folds the paid bill read's own position and hold", () => {
    const window = { readThroughMs: 3_000_000, endMs: 9_000_000, held: true };
    const held = nextCursor({ ...run, paidBillWindow: window });
    const expired = nextCursor({
      ...run,
      previous: { ...previous, paidBillHeldSinceMs: 1 },
      paidBillWindow: window,
      nowMs: 1 + 7 * DAY_MS + 1,
    });
    const asked = nextCursor({
      ...run,
      previous: { ...previous, paidBillReadThroughMs: 7, paidBillHeldSinceMs: 5 },
    });

    expect(held).toMatchObject({
      paidBillReadThroughMs: 3_000_000,
      paidBillHeldSinceMs: 20_000_000,
    });
    expect(expired).toMatchObject({ paidBillReadThroughMs: 9_000_000, paidBillHeldSinceMs: null });
    expect(asked).toMatchObject({ paidBillReadThroughMs: 7, paidBillHeldSinceMs: null });
  });
});
