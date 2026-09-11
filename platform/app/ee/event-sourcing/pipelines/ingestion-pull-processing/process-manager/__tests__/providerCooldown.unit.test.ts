/**
 * A wait a provider asked for, held against the connection rather than the
 * attempt that received it.
 *
 * The defect these cover is one shape seen from several sides: a run told to
 * wait was replaced, and the wait died with the run, so the replacement went
 * straight back to a provider that had just said no. Everything here is
 * evolve-level — the same definition the runtime mounts, built through the
 * pipeline's own applier — because that is where a wake decides whether to ask
 * a provider anything.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */

import { ingestionPullPM } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/pipeline";
import { INGESTION_PULL_EVENT_TYPES } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullProcessingEvent } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/events";
import { describe, expect, it } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessInput,
} from "~/server/event-sourcing/process-manager";
import { ensureJsonSafe } from "~/server/event-sourcing/process-manager/json";
import { buildProcessDefinition } from "~/server/event-sourcing/process-manager/processRuntime";

import { INGESTION_PULL_MAX_COOLDOWN_MS } from "../ingestionPull.process";
import {
  INGESTION_PULL_PROCESS_NAME,
  type IngestionPullProcessState,
} from "../ingestionPullProcess.types";

const definition = buildProcessDefinition(
  buildProcessManager<IngestionPullProcessingEvent>({
    name: INGESTION_PULL_PROCESS_NAME,
    applier: ingestionPullPM({
      runPort: { run: () => Promise.reject(new Error("unused")) },
      agentListingPort: { list: () => Promise.reject(new Error("unused")) },
      peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
      commands: () => {
        throw new Error("unused in evolve tests");
      },
    }),
  }).config,
) as ProcessDefinition<IngestionPullProcessState>;

const ref = {
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: "gov-project",
  processKey: "source-1",
};

/** Every fifteen minutes, so a wait of hours plainly outlasts the cadence. */
const CRON = "*/15 * * * *";

const configured = (occurredAt: number): ProcessEventEnvelope => ({
  eventId: `event-${occurredAt}`,
  eventType: INGESTION_PULL_EVENT_TYPES.CONFIGURED,
  occurredAt,
  tenantId: "gov-project",
  projectId: "gov-project",
  processKey: "source-1",
  payload: {
    sourceId: "source-1",
    cron: CRON,
    cursor: "cursor-1",
    runId: null,
  },
});

const runFailed = ({
  at,
  runId,
  retryAfterMs,
}: {
  at: number;
  runId: string;
  retryAfterMs?: number | null;
}): ProcessEventEnvelope => ({
  eventId: `failed-${at}`,
  eventType: INGESTION_PULL_EVENT_TYPES.RUN_FAILED,
  occurredAt: at,
  tenantId: "gov-project",
  projectId: "gov-project",
  processKey: "source-1",
  payload: {
    sourceId: "source-1",
    // The content boundary hands every handler the same view shape, so a
    // failure carries these as null rather than omitting them.
    cron: null,
    cursor: null,
    runId,
    scheduledFor: at,
    error: "HTTP 429",
    errorCode: "pull_failed",
    retryable: false,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  },
});

function evolve({
  previousState,
  input,
}: {
  previousState: IngestionPullProcessState;
  input: ProcessInput;
}) {
  return definition.evolve({ previousState, input, ref });
}

function boot(at: number) {
  return evolve({
    previousState: definition.initialState,
    input: { kind: "event", event: configured(at), now: at },
  });
}

/** The state of a source that has just been told to wait `retryAfterMs`. */
function refusedAt({
  at,
  retryAfterMs,
  runId = "run-1",
}: {
  at: number;
  retryAfterMs?: number | null;
  runId?: string;
}) {
  const booted = boot(at).state;
  return evolve({
    previousState: {
      ...booted,
      currentRun: { runId, scheduledFor: at, startedAt: at },
    },
    input: {
      kind: "event",
      event: runFailed({ at, runId, retryAfterMs }),
      now: at,
    },
  });
}

const T0 = Date.parse("2026-09-14T10:00:00Z");
const ONE_HOUR = 60 * 60 * 1000;

describe("given a provider answering that too many requests were made", () => {
  /** @scenario "A provider answering that too many requests were made has its wait read" */
  it("waits at least as long as the provider asked", () => {
    const result = refusedAt({ at: T0, retryAfterMs: ONE_HOUR });

    expect(result.nextWakeAt).toBe(T0 + ONE_HOUR);
  });

  /** @scenario "A provider answering that too many requests were made has its wait read" */
  it("does not fall back to the short fixed delay the cadence would give it", () => {
    const result = refusedAt({ at: T0, retryAfterMs: ONE_HOUR });

    // The cadence alone would have this source back at the provider in
    // fifteen minutes, inside the window it was just refused in.
    expect(result.nextWakeAt).not.toBe(Date.parse("2026-09-14T10:15:00Z"));
  });

  /** @scenario "The next scheduled run is pushed past the wait" */
  it("leaves the cadence the admin chose unchanged", () => {
    const result = refusedAt({ at: T0, retryAfterMs: ONE_HOUR });

    expect(result.state.cron).toBe(CRON);
  });

  /** @scenario "The next scheduled run is pushed past the wait" */
  it("schedules a tick that would fall inside the wait for the end of the wait", () => {
    const result = refusedAt({ at: T0, retryAfterMs: ONE_HOUR });

    // Four cron ticks fall inside the hour. None of them is the answer.
    expect(result.nextWakeAt).toBeGreaterThanOrEqual(T0 + ONE_HOUR);
  });
});

describe("given a provider asking for a wait longer than a day", () => {
  /** @scenario "A wait longer than a day is trimmed to a day" */
  it("waits a day at most", () => {
    const result = refusedAt({ at: T0, retryAfterMs: 30 * 24 * ONE_HOUR });

    expect(result.state.cooldownUntil).toBe(
      T0 + INGESTION_PULL_MAX_COOLDOWN_MS,
    );
  });
});

describe("given a wait that cannot be read as a length of time", () => {
  /** @scenario "A wait that cannot be read as a length of time is treated as no wait" */
  it("falls back to its usual cadence rather than refusing to schedule", () => {
    const result = refusedAt({ at: T0, retryAfterMs: Number.NaN });

    expect(result.nextWakeAt).toBe(Date.parse("2026-09-14T10:15:00Z"));
  });

  /** @scenario "A wait that cannot be read as a length of time is treated as no wait" */
  it("records no wait at all, so nothing downstream reads a figure it cannot use", () => {
    const result = refusedAt({ at: T0, retryAfterMs: Number.NaN });

    // Exactly null, never absent-or-undefined: the state is persisted as
    // JSON, and `undefined` at this key is what used to park the source.
    expect(result.state.cooldownUntil).toBeNull();
    expect(() => ensureJsonSafe(result.state)).not.toThrow();
  });

  /** @scenario "A wait that cannot be read as a length of time is treated as no wait" */
  it("keeps scheduling a failure that named no wait at all", () => {
    const result = refusedAt({ at: T0, retryAfterMs: null });

    expect(result.nextWakeAt).toBe(Date.parse("2026-09-14T10:15:00Z"));
  });
});

describe("given a run that was replaced before the wait it was told about had passed", () => {
  /** @scenario "A replacement run honours a wait the run it replaced was told about" */
  it("does not ask the provider until the wait has passed", () => {
    const refused = refusedAt({ at: T0, retryAfterMs: ONE_HOUR }).state;
    // The wake the replacement would run on, arriving inside the wait.
    const insideTheWait = T0 + 15 * 60 * 1000;

    const woken = evolve({
      previousState: refused,
      input: { kind: "wake", scheduledFor: insideTheWait, now: insideTheWait },
    });

    expect(woken.intents).toEqual([]);
  });

  /** @scenario "A replacement run honours a wait the run it replaced was told about" */
  it("asks again once the wait has passed", () => {
    const refused = refusedAt({ at: T0, retryAfterMs: ONE_HOUR }).state;
    const afterTheWait = T0 + ONE_HOUR + 1000;

    const woken = evolve({
      previousState: refused,
      input: { kind: "wake", scheduledFor: afterTheWait, now: afterTheWait },
    });

    expect(woken.intents).toHaveLength(1);
  });

  /**
   * The wait belongs to the connection, so it survives the process no longer
   * tracking the run that was told about it. Without this, an abandoned run's
   * refusal is read as somebody else's business and dropped.
   */
  /** @scenario "A replacement run honours a wait the run it replaced was told about" */
  it("holds a wait told to a run this process had already stopped tracking", () => {
    const booted = boot(T0).state;

    const refused = evolve({
      previousState: {
        ...booted,
        currentRun: { runId: "replacement", scheduledFor: T0, startedAt: T0 },
      },
      input: {
        kind: "event",
        // The abandoned run's own refusal, arriving after its replacement
        // has already taken the slot.
        event: runFailed({
          at: T0,
          runId: "abandoned",
          retryAfterMs: ONE_HOUR,
        }),
        now: T0,
      },
    });

    expect(refused.state.cooldownUntil).toBe(T0 + ONE_HOUR);
    // The replacement is still the run in flight: a late outcome from a run
    // this process no longer tracks must not cancel the one that is.
    expect(refused.state.currentRun?.runId).toBe("replacement");
  });
});

/**
 * The wait a provider named starts when the provider named it. Measuring it
 * from the moment we get round to reading the refusal stretches it by however
 * far the subscriber is behind, and re-reading an old refusal during a replay
 * would park a live source on a wait that expired long ago.
 */
describe("given a refusal read long after the provider gave it", () => {
  const LATE_BY = 30 * 60 * 1000;

  /** @scenario "A provider answering that too many requests were made has its wait read" */
  it("ends the wait an hour after the refusal, not an hour after it was read", () => {
    const booted = boot(T0).state;

    const refused = evolve({
      previousState: {
        ...booted,
        currentRun: { runId: "run-1", scheduledFor: T0, startedAt: T0 },
      },
      input: {
        kind: "event",
        event: runFailed({ at: T0, runId: "run-1", retryAfterMs: ONE_HOUR }),
        now: T0 + LATE_BY,
      },
    });

    expect(refused.state.cooldownUntil).toBe(T0 + ONE_HOUR);
  });

  /** @scenario "A provider answering that too many requests were made has its wait read" */
  it("does not re-arm a wait that had already passed by the time it was read", () => {
    const booted = boot(T0).state;
    // Read a full day late: the hour the provider asked for is long gone.
    const readAt = T0 + 24 * ONE_HOUR;

    const refused = evolve({
      previousState: {
        ...booted,
        currentRun: { runId: "run-1", scheduledFor: T0, startedAt: T0 },
      },
      input: {
        kind: "event",
        event: runFailed({ at: T0, runId: "run-1", retryAfterMs: ONE_HOUR }),
        now: readAt,
      },
    });

    // The next wake is the ordinary cadence off the present, with no wait
    // standing between the source and its provider.
    expect(refused.nextWakeAt).toBe(readAt + 15 * 60 * 1000);
  });
});

describe("given a run that has been going longer than it is allowed to", () => {
  const STALE_BY = 31 * 60 * 1000;

  /** @scenario "A run replaced before it finished records that it was abandoned" */
  it("names the run it replaced on the intent that replaces it", () => {
    const booted = boot(T0).state;
    const wakeAt = T0 + STALE_BY;

    const woken = evolve({
      previousState: {
        ...booted,
        currentRun: { runId: "run-old", scheduledFor: T0, startedAt: T0 },
      },
      input: { kind: "wake", scheduledFor: wakeAt, now: wakeAt },
    });

    expect(woken.intents[0]).toMatchObject({
      payload: { abandonedRunId: "run-old", runId: String(wakeAt) },
    });
  });

  /** @scenario "A run replaced before it finished records that it was abandoned" */
  it("says nothing about an abandoned run when there was none to replace", () => {
    const booted = boot(T0).state;
    const wakeAt = T0 + STALE_BY;

    const woken = evolve({
      previousState: booted,
      input: { kind: "wake", scheduledFor: wakeAt, now: wakeAt },
    });

    expect(
      Object.hasOwn(
        (woken.intents[0] as { payload: object }).payload,
        "abandonedRunId",
      ),
    ).toBe(false);
  });
});
