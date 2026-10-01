import { INGESTION_PULL_EVENT_TYPES } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { INGESTION_PULL_MAX_COOLDOWN_MS } from "../../rules/ingestion-pull-cooldown.rules.ts";
import { INGESTION_PULL_STALE_RUN_MS } from "../ingestion-pull.process.ts";
import { CADENCE_MS, configuredState, onEvent, onWake } from "./ingestion-pull.fixtures.ts";

const HOUR = 60 * 60_000;

function refused({
  runId = "run-1",
  retryAfterMs,
}: {
  runId?: string;
  retryAfterMs?: number | null;
}) {
  return {
    sourceId: "source-1",
    runId,
    scheduledFor: 1_000,
    error: "too many requests",
    errorCode: "pull_failed",
    retryable: false,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  };
}

const running = { runId: "run-1", scheduledFor: 1_000, startedAt: 1_000 };

describe("given a provider answering that too many requests were made", () => {
  /** @scenario "A provider answering that too many requests were made has its wait read" */
  it("waits at least as long as the provider asked", () => {
    const result = onEvent({
      state: configuredState({ currentRun: running }),
      eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
      data: refused({ retryAfterMs: HOUR }),
      occurredAt: 2_000,
    });

    expect(result.state).toMatchObject({ cooldownUntil: 2_000 + HOUR, currentRun: null });
    expect(result.nextWakeAt).toBe(2_000 + HOUR);
  });

  /** @scenario "The next scheduled run is pushed past the wait" */
  it("leaves the cadence the admin chose unchanged", () => {
    const result = onEvent({
      state: configuredState({ currentRun: running }),
      eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
      data: refused({ retryAfterMs: HOUR }),
    });

    expect(result.state).toMatchObject({ cron: "*/15 * * * *" });
  });

  /** @scenario "A provider answering that too many requests were made has its wait read" */
  it("ends the wait an hour after the refusal, not an hour after it was read", () => {
    const result = onEvent({
      state: configuredState({ currentRun: running }),
      eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
      data: refused({ retryAfterMs: HOUR }),
      occurredAt: 2_000,
      now: 2_000 + 3 * HOUR,
    });

    expect(result.state).toMatchObject({ cooldownUntil: 2_000 + HOUR });
  });
});

describe("given a provider asking for a wait longer than a day", () => {
  /** @scenario "A wait longer than a day is trimmed to a day" */
  it("waits a day at most", () => {
    const result = onEvent({
      state: configuredState({ currentRun: running }),
      eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
      data: refused({ retryAfterMs: 30 * 24 * HOUR }),
      occurredAt: 2_000,
    });

    expect(result.state).toMatchObject({ cooldownUntil: 2_000 + INGESTION_PULL_MAX_COOLDOWN_MS });
  });
});

describe("given a wait that cannot be read as a length of time", () => {
  /** @scenario "A wait that cannot be read as a length of time is treated as no wait" */
  it("falls back to its usual cadence and records no wait", () => {
    const result = onEvent({
      state: configuredState({ currentRun: running }),
      eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
      data: refused({ retryAfterMs: -5 }),
      occurredAt: 2_000,
    });

    expect(result.state).toMatchObject({ cooldownUntil: null });
    expect(result.nextWakeAt).toBe(2_000 + CADENCE_MS);
  });

  /** @scenario "A wait that cannot be read as a length of time is treated as no wait" */
  it("keeps scheduling a failure that named no wait at all", () => {
    const result = onEvent({
      state: configuredState({ currentRun: running }),
      eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
      data: refused({}),
      occurredAt: 2_000,
    });

    expect(result.nextWakeAt).toBe(2_000 + CADENCE_MS);
  });
});

describe("given a run that was replaced before the wait it was told about had passed", () => {
  /** @scenario "A replacement run honours a wait the run it replaced was told about" */
  it("does not ask the provider until the wait has passed", () => {
    const result = onWake({
      state: configuredState({ cooldownUntil: 10 * HOUR }),
      scheduledFor: 5 * HOUR,
    });

    expect(result.intents).toEqual([]);
    expect(result.nextWakeAt).toBe(10 * HOUR);
  });

  /** @scenario "A replacement run honours a wait the run it replaced was told about" */
  it("asks again once the wait has passed", () => {
    const result = onWake({
      state: configuredState({ cooldownUntil: HOUR }),
      scheduledFor: 2 * HOUR,
    });

    expect(result.intents).toMatchObject([{ intentType: "run" }]);
  });

  /** @scenario "A replacement run honours a wait the run it replaced was told about" */
  it("holds a wait told to a run this process had already stopped tracking", () => {
    const result = onEvent({
      state: configuredState({ currentRun: { ...running, runId: "run-2" } }),
      eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
      data: refused({ runId: "run-1", retryAfterMs: HOUR }),
      occurredAt: 2_000,
    });

    expect(result.state).toMatchObject({
      cooldownUntil: 2_000 + HOUR,
      currentRun: { runId: "run-2" },
    });
  });
});

describe("given a run that outlived its allowance", () => {
  /** @scenario "A run replaced before it finished records that it was abandoned" */
  it("hands the replacement the abandoned run's id", () => {
    const scheduledFor = 1_000 + INGESTION_PULL_STALE_RUN_MS;
    const result = onWake({ state: configuredState({ currentRun: running }), scheduledFor });

    expect(result.intents).toMatchObject([
      { intentType: "run", payload: { runId: String(scheduledFor), abandonedRunId: "run-1" } },
    ]);
  });
});
