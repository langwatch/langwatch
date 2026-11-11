/** Pins every outcome of a claimed job as the ordered calls it makes; see ADR-090 and ADR-080. */

import { nowInstant } from "@langwatch/time";
import { Redis as IORedis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle.ts";
import { HandBackGroupQueueError, NonRetryableGroupQueueError } from "../errors.ts";
import {
  GroupQueueProcessor,
  HAND_BACK_CONFIG,
  handBackOutcome,
  JOB_RETRY_CONFIG,
} from "../groupQueue.ts";
import { PayloadTooLargeError } from "../jobEnvelope.ts";
import { type DrainedJob, GroupStagingScripts } from "../scripts.ts";
import { TransientBlobStoreError } from "../tieredBlobStore.ts";

vi.mock("../dispatcher.ts", () => ({
  GroupQueueDispatcher: class {
    start(): void {}
    requestShutdown(): void {}
    async waitUntilStopped(): Promise<void> {}
  },
}));

vi.mock("../metricsCollector.ts", () => ({
  GroupQueueMetricsCollector: class {
    start(): void {}
    stop(): void {}
  },
}));

type TestPayload = { id: string; groupId: string };

const GROUP = "project_1/g1";
const TIME_KEYS = new Set(["nowMs", "dispatchAfterMs", "backoffMs", "at", "leasedUntil", "score"]);

/** Arguments as they would read on a wire: functions and clock values are elided. */
function normalise(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, entry) => {
      if (typeof entry === "function") return "<fn>";
      if (TIME_KEYS.has(key)) return "<time>";
      if (/stack/i.test(key)) return "<stack>";
      if (entry instanceof Error) return `<${entry.name}: ${entry.message}>`;
      return entry;
    }),
  );
}

function jobValue(id: string, jobName = "job"): string {
  return JSON.stringify({ id, groupId: GROUP, __jobName: jobName, __attempt: 1 });
}

type Scenario = {
  decode?: (value: string) => Promise<Record<string, unknown>>;
  process?: (payload: TestPayload) => Promise<void>;
  processBatch?: (payloads: TestPayload[]) => Promise<void>;
  siblings?: DrainedJob[];
  failStreak?: number;
  retryable?: boolean;
  retryAfterMs?: number;
  /** Another worker recovered the claim, so every fenced write answers false. */
  claimLost?: boolean;
  onExhausted?: GroupQueueRuntimeDefinition<TestPayload>["onExhausted"];
};

const connections: IORedis[] = [];

function recordingProcessor(scenario: Scenario): {
  processor: GroupQueueProcessor<TestPayload>;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const log = (name: string, args: unknown[]): void => {
    calls.push([name, normalise(args)]);
  };

  const conn = new IORedis({ lazyConnect: true, maxRetriesPerRequest: 0 });
  connections.push(conn);
  vi.spyOn(conn, "get").mockImplementation(async (...args: unknown[]) => {
    log("redis.get", args);
    return null;
  });
  vi.spyOn(conn, "del").mockImplementation(async (...args: unknown[]) => {
    log("redis.del", args);
    return 1;
  });
  vi.spyOn(conn, "evalsha").mockImplementation(async () => {
    log("redis.evalsha", []);
    return scenario.claimLost ? -1 : 1;
  });

  const scriptAnswers: [keyof GroupStagingScripts, () => unknown][] = [
    ["complete", () => !scenario.claimLost],
    ["drainGroupReady", () => scenario.siblings ?? []],
    ["refreshActiveKey", () => undefined],
    ["restageAndBlock", () => !scenario.claimLost],
    ["retryRestage", () => true],
    ["recordGroupFailure", () => scenario.failStreak ?? 1],
    ["clearGroupFailures", () => undefined],
    ["stage", () => ({ isNew: true, orphanedValue: "", claimLost: Boolean(scenario.claimLost) })],
    ["discardClaim", () => undefined],
    ["releaseClaim", () => undefined],
    ["retireWorker", () => undefined],
    ["recordWorkerAlive", () => undefined],
  ];
  for (const [name, answer] of scriptAnswers) {
    vi.spyOn(GroupStagingScripts.prototype, name).mockImplementation(async (...args: unknown[]) => {
      log(`scripts.${name}`, args);
      return answer();
    });
  }

  const decode = scenario.decode ?? (async (value: string) => JSON.parse(value));
  vi.spyOn(EnvelopeBlobLifecycle.prototype, "decode").mockImplementation(async (input) => {
    log("blob.decode", [input]);
    return decode(input.value);
  });
  vi.spyOn(EnvelopeBlobLifecycle.prototype, "encode").mockImplementation(async (input) => {
    log("blob.encode", [input]);
    return JSON.stringify(input.jobData);
  });
  for (const name of ["releaseLease", "transferLease", "renewLease"] as const) {
    vi.spyOn(EnvelopeBlobLifecycle.prototype, name).mockImplementation(async (...args) => {
      log(`blob.${name}`, args);
    });
  }

  const handleBatch = scenario.processBatch;
  const definition: GroupQueueRuntimeDefinition<TestPayload> = {
    name: "{test/gq/characterize}",
    process: async (payload) => {
      log("handler.process", [payload]);
      await (scenario.process ?? (async () => {}))(payload);
    },
    groupKey: (payload) => payload.groupId,
    identify: (payload) => payload.id,
    ...(scenario.onExhausted ? { onExhausted: scenario.onExhausted } : {}),
    ...(handleBatch
      ? {
          processBatch: async (payloads: TestPayload[]) => {
            log("handler.processBatch", [payloads]);
            await handleBatch(payloads);
          },
          coalesceMaxBatch: () => 3,
        }
      : {}),
  };
  const processor = new GroupQueueProcessor<TestPayload>(definition, conn, {
    consumerEnabled: false,
    failures: {
      classify: () => ({
        retryable: scenario.retryable ?? true,
        ...(scenario.retryAfterMs === undefined ? {} : { retryAfterMs: scenario.retryAfterMs }),
      }),
    },
  });
  return { processor, calls };
}

async function runClaimed(scenario: Scenario): Promise<unknown[]> {
  const { processor, calls } = recordingProcessor(scenario);
  await processor["processClaimedJob"]({
    stagedJobId: "job-1",
    groupId: GROUP,
    jobDataJson: jobValue("job-1"),
    originalScore: 1000,
    claimToken: "claim-1",
  });
  return calls;
}

afterEach(() => {
  for (const conn of connections.splice(0)) conn.disconnect();
  vi.restoreAllMocks();
});

describe("given a claimed job", () => {
  it("completes a job whose handler succeeds", async () => {
    expect(await runClaimed({})).toMatchSnapshot();
  });

  it("re-stages a job whose handler fails retryably", async () => {
    const calls = await runClaimed({
      process: async () => {
        throw new Error("handler failed");
      },
    });
    expect(calls).toMatchSnapshot();
  });

  it("blocks the group when the handler fails for good", async () => {
    const calls = await runClaimed({
      retryable: false,
      process: async () => {
        throw new NonRetryableGroupQueueError("never again");
      },
    });
    expect(calls).toMatchSnapshot();
  });

  it("quarantines a group past its failure streak", async () => {
    const calls = await runClaimed({
      failStreak: 10_000,
      process: async () => {
        throw new Error("handler failed");
      },
    });
    expect(calls).toMatchSnapshot();
  });

  it("parks the group when the payload is oversized", async () => {
    const calls = await runClaimed({
      decode: async () => {
        throw new PayloadTooLargeError(99_999_999);
      },
    });
    expect(calls).toMatchSnapshot();
  });

  it("retries a job whose body is transiently unreachable", async () => {
    const calls = await runClaimed({
      decode: async () => {
        throw new TransientBlobStoreError({ projectId: "project_1", hash: "h", cause: "down" });
      },
    });
    expect(calls).toMatchSnapshot();
  });

  describe("when the job spent its earlier retries on an overloaded server", () => {
    /** A stored envelope whose header carries the attempt and the overload retries spent. */
    type SpentRetries = { attempt: number; overloadAttempts: number };
    const storedAfterOverload = ({ attempt, overloadAttempts }: SpentRetries) => {
      const header = JSON.stringify({
        v: 2,
        e: "j",
        m: { __attempt: attempt, __overloadAttempts: overloadAttempts },
      });
      return `GQ2|${Buffer.byteLength(header)}|${header}${JSON.stringify({ id: "job-1" })}`;
    };
    const unreachable = async (): Promise<Record<string, unknown>> => {
      throw new TransientBlobStoreError({ projectId: "project_1", hash: "h", cause: "down" });
    };
    const transientOutcome = async ({ attempt, overloadAttempts }: SpentRetries) => {
      const { processor, calls } = recordingProcessor({ decode: unreachable });
      await processor["processClaimedJob"]({
        stagedJobId: "job-1",
        groupId: GROUP,
        jobDataJson: storedAfterOverload({ attempt, overloadAttempts }),
        originalScore: 1000,
        claimToken: "claim-1",
      });
      const named = (name: string) =>
        calls.filter((call) => Array.isArray(call) && call[0] === name);
      return { restaged: named("scripts.retryRestage"), discarded: named("scripts.discardClaim") };
    };

    /** @scenario "An ordinary failure after an overload spell still gets its ordinary budget" */
    it("re-stages a transiently unreachable body past the ordinary attempt count", async () => {
      const { restaged, discarded } = await transientOutcome({ attempt: 30, overloadAttempts: 29 });

      expect(restaged).toHaveLength(1);
      expect(restaged[0]).toEqual([
        "scripts.retryRestage",
        [expect.objectContaining({ attempt: 31 })],
      ]);
      expect(discarded).toHaveLength(0);
    });

    it("drops it once the ordinary rungs on top of the overload retries are spent", async () => {
      const { restaged } = await transientOutcome({ attempt: 54, overloadAttempts: 29 });

      expect(restaged).toHaveLength(0);
    });
  });

  it("drops a job whose value cannot be decoded", async () => {
    const calls = await runClaimed({
      decode: async () => {
        throw new Error("garbled");
      },
    });
    expect(calls).toMatchSnapshot();
  });
});

describe("given a claimed job whose claim another worker recovered", () => {
  const named = (calls: unknown[], name: string) =>
    calls.filter((call) => Array.isArray(call) && call[0] === name);

  /** @scenario "A former owner that dead-letters or parks a recovered job leaves the group alone" */
  it("dead-letters without clearing the group's failures or attempt count", async () => {
    const calls = await runClaimed({
      claimLost: true,
      retryable: false,
      onExhausted: () => "dead-letter",
      process: async () => {
        throw new NonRetryableGroupQueueError("never again");
      },
    });
    expect(named(calls, "scripts.complete")).toHaveLength(1);
    expect(named(calls, "scripts.clearGroupFailures")).toHaveLength(0);
    expect(named(calls, "redis.del")).toHaveLength(0);
  });

  /** @scenario "A former owner that dead-letters or parks a recovered job leaves the group alone" */
  it("parks nothing and leaves the claim marker in place", async () => {
    const calls = await runClaimed({
      claimLost: true,
      decode: async () => {
        throw new PayloadTooLargeError(99_999_999);
      },
    });
    expect(named(calls, "scripts.restageAndBlock")).toHaveLength(1);
    expect(named(calls, "scripts.discardClaim")).toHaveLength(0);
  });

  /** @scenario "A former owner's dead-letter and re-stage leave the recovering worker's state alone" */
  it("stops re-staging its drained siblings at the first refusal", async () => {
    const calls = await runClaimed({
      claimLost: true,
      siblings: [
        { stagedJobId: "job-2", jobDataJson: jobValue("job-2"), originalScore: 1001 },
        { stagedJobId: "job-3", jobDataJson: jobValue("job-3"), originalScore: 1002 },
      ],
      processBatch: async () => {},
      decode: async (value) => {
        if (value.includes("job-2")) {
          throw new TransientBlobStoreError({ projectId: "project_1", hash: "h", cause: "down" });
        }
        return JSON.parse(value);
      },
    });
    expect(named(calls, "scripts.stage")).toHaveLength(1);
  });
});

describe("given a claimed job under the poison guard", () => {
  const OUTCOMES = new Set(["scripts.complete", "scripts.retryRestage", "scripts.restageAndBlock"]);
  const fails = async () => {
    throw new Error("handler failed");
  };
  const failsForGood = async () => {
    throw new NonRetryableGroupQueueError("never again");
  };
  const outcomes: [string, Scenario][] = [
    ["completes", {}],
    ["is re-staged for a retry", { process: fails }],
    ["blocks its group", { retryable: false, process: failsForGood }],
  ];

  /** @scenario "an outcome releases the claim marker only inside its own fenced step" */
  it.each(outcomes)(
    "names its claim and sends no separate release when it %s",
    async (_, scenario) => {
      for (const claimLost of [false, true]) {
        const calls = (await runClaimed({ ...scenario, claimLost })) as [string, unknown[]][];
        const sent = calls.filter(([name]) => OUTCOMES.has(name));
        expect(sent).toHaveLength(1);
        expect(sent[0]![1][0]).toMatchObject({ claimToken: "claim-1" });
        const names = calls.map(([name]) => name);
        expect(names).not.toContain("scripts.releaseClaim");
        expect(names).not.toContain("scripts.discardClaim");
        expect(names).not.toContain("redis.evalsha");
      }
    },
  );
});

describe("given a claimed job that coalesces its siblings", () => {
  const siblings: DrainedJob[] = [
    { stagedJobId: "job-2", jobDataJson: jobValue("job-2"), originalScore: 1001 },
    { stagedJobId: "job-3", jobDataJson: jobValue("job-3", "other"), originalScore: 1002 },
    { stagedJobId: "job-4", jobDataJson: jobValue("job-4"), originalScore: 1003 },
  ];

  it("processes the batch and restages a sibling of another job", async () => {
    const calls = await runClaimed({ siblings, processBatch: async () => {} });
    expect(calls).toMatchSnapshot();
  });

  it("bisects a batch that fails until the poison payload is alone", async () => {
    const calls = await runClaimed({
      siblings,
      processBatch: async (payloads) => {
        if (payloads.some((payload) => payload.id === "job-4")) throw new Error("poison");
      },
    });
    expect(calls).toMatchSnapshot();
  });

  it("restages the siblings when a sibling body is transiently unreachable", async () => {
    const calls = await runClaimed({
      siblings,
      processBatch: async () => {},
      decode: async (value) => {
        if (value.includes("job-2")) {
          throw new TransientBlobStoreError({ projectId: "project_1", hash: "h", cause: "down" });
        }
        return JSON.parse(value);
      },
    });
    expect(calls).toMatchSnapshot();
  });
});

describe("given a coalesced batch that fails", () => {
  const siblings: DrainedJob[] = [
    { stagedJobId: "job-2", jobDataJson: jobValue("job-2"), originalScore: 1001 },
    { stagedJobId: "job-3", jobDataJson: jobValue("job-3"), originalScore: 1002 },
  ];
  const named = (calls: unknown[], name: string) =>
    calls.filter((call) => Array.isArray(call) && call[0] === name);

  describe("when the failure names a retry delay because the server is overloaded", () => {
    /** @scenario "An overloaded server backs the whole batch off instead of splitting it" */
    it("re-stages the whole batch with a delay and makes zero splits", async () => {
      const { processor, calls } = recordingProcessor({
        siblings,
        retryAfterMs: 0,
        processBatch: async () => {
          throw new Error("Code: 241. DB::Exception: MEMORY_LIMIT_EXCEEDED");
        },
      });
      const warn = vi.spyOn(processor["logger"], "warn");

      await processor["processClaimedJob"]({
        stagedJobId: "job-1",
        groupId: GROUP,
        jobDataJson: jobValue("job-1"),
        originalScore: 1000,
        claimToken: "claim-1",
      });

      expect(named(calls, "handler.processBatch")).toHaveLength(1);
      expect(named(calls, "scripts.retryRestage")).toHaveLength(1);
      expect(named(calls, "scripts.stage")).toHaveLength(siblings.length);
      const messages = warn.mock.calls.map((call) => call[1]);
      expect(messages).not.toContain(
        "Coalesced batch failed; splitting in half and retrying each half in order",
      );
      const backoffs = warn.mock.calls.filter(
        (call) => call[1] === "Job attempt failed, re-staged with backoff",
      );
      expect(backoffs).toHaveLength(1);
      expect(backoffs[0]?.[0]).toMatchObject({ backoffMs: expect.any(Number) });
    });
  });

  describe("when the failure is retryable and names no delay", () => {
    it("still splits the batch", async () => {
      const calls = await runClaimed({
        siblings,
        processBatch: async () => {
          throw new Error("handler failed");
        },
      });

      expect(named(calls, "handler.processBatch").length).toBeGreaterThan(1);
    });
  });
});

describe("given a claimed job this worker has no handler for", () => {
  const callsNamed = (calls: unknown[], name: string): unknown[][] =>
    calls.flatMap((call) =>
      Array.isArray(call) && call[0] === name ? [call[1] as unknown[]] : [],
    );
  const handedBackJob = (handedBackSince?: number): string =>
    JSON.stringify({
      id: "job-1",
      groupId: GROUP,
      __jobName: "job",
      __attempt: 1,
      ...(handedBackSince === undefined ? {} : { __handedBackSince: handedBackSince }),
    });
  const runHandedBack = async (handedBackSince?: number) => {
    const { processor, calls } = recordingProcessor({
      process: async () => {
        throw new HandBackGroupQueueError("no handler registered in this worker");
      },
    });
    const warn = vi.spyOn(processor["logger"], "warn");
    const error = vi.spyOn(processor["logger"], "error");
    await processor["processClaimedJob"]({
      stagedJobId: "job-1",
      groupId: GROUP,
      jobDataJson: handedBackJob(handedBackSince),
      originalScore: 1000,
      claimToken: "claim-1",
    });
    return { calls, warn, error };
  };

  describe("when the handler hands it back", () => {
    /** @scenario "A handed-back job keeps its attempt count and its group is not blocked" */
    it("re-stages it on the same attempt without counting a failure", async () => {
      const { calls, warn } = await runHandedBack();

      expect(callsNamed(calls, "scripts.retryRestage")).toEqual([
        [expect.objectContaining({ attempt: 1 })],
      ]);
      expect(callsNamed(calls, "blob.encode")).toEqual([
        [
          expect.objectContaining({
            jobData: expect.objectContaining({
              __attempt: 1,
              __handedBackSince: expect.any(Number),
            }),
          }),
        ],
      ]);
      expect(callsNamed(calls, "scripts.recordGroupFailure")).toHaveLength(0);
      expect(callsNamed(calls, "scripts.restageAndBlock")).toHaveLength(0);
      expect(warn.mock.calls.map((call) => call[1])).toContain(
        "No handler for this job in this worker; handed it back without using an attempt",
      );
    });
  });

  describe("when it was first handed back longer ago than the window", () => {
    /** @scenario "A job handed back for longer than the window spends attempts at error" */
    it("retries it on the next attempt, counts the failure and logs at error", async () => {
      const since = nowInstant().epochMilliseconds - HAND_BACK_CONFIG.windowMs - 60_000;
      const { calls, error } = await runHandedBack(since);

      expect(callsNamed(calls, "scripts.recordGroupFailure")).toHaveLength(1);
      expect(callsNamed(calls, "scripts.retryRestage")).toEqual([
        [expect.objectContaining({ attempt: 2 })],
      ]);
      expect(callsNamed(calls, "blob.encode")).toEqual([
        [
          expect.objectContaining({
            jobData: expect.objectContaining({ __attempt: 2, __handedBackSince: since }),
          }),
        ],
      ]);
      expect(error.mock.calls.map((call) => call[1])).toContain(
        "No worker has run this job since it was first handed back; spending its attempts so it surfaces",
      );
    });
  });
});

describe("handBackOutcome", () => {
  /** @scenario "The hand-back window starts at the first hand-back" */
  it("starts the window at the first hand-back and keeps a later start unchanged", () => {
    expect(handBackOutcome({ handedBackSince: undefined, now: 5_000 })).toEqual({
      kind: "hand-back",
      since: 5_000,
    });
    expect(handBackOutcome({ handedBackSince: 1_000, now: 5_000 })).toEqual({
      kind: "hand-back",
      since: 1_000,
    });
    expect(
      handBackOutcome({ handedBackSince: 1_000, now: 1_000 + HAND_BACK_CONFIG.windowMs }),
    ).toEqual({ kind: "spend-attempt", since: 1_000 });
  });
});

describe("given a dispatch that read the group's retry-chain counter inside the claim", () => {
  const named = (calls: unknown[], name: string) =>
    calls.filter((call) => Array.isArray(call) && call[0] === name);
  const dispatched = {
    stagedJobId: "job-1",
    groupId: GROUP,
    jobDataJson: jobValue("job-1"),
    originalScore: 1000,
    claimToken: "claim-1",
  };

  it("takes the counter from the claim and does not read it from Redis", async () => {
    const { processor, calls } = recordingProcessor({});

    await processor["processWithRetries"]({ ...dispatched, groupAttempt: 4 });

    expect(named(calls, "handler.process")).toHaveLength(1);
    expect(named(calls, "redis.get")).toHaveLength(0);
  });

  describe("when the job has used the ordinary attempt budget", () => {
    const spent = { ...dispatched, groupAttempt: JOB_RETRY_CONFIG.maxAttempts };
    const failing = async () => {
      throw new Error("Too many queries in flight");
    };

    /** @scenario "An overloaded server does not spend a group's ordinary retry budget" */
    it("re-stages an overloaded failure instead of blocking the group", async () => {
      const { processor, calls } = recordingProcessor({ retryAfterMs: 0, process: failing });

      await processor["processWithRetries"](spent);

      expect(named(calls, "scripts.retryRestage")).toHaveLength(1);
      expect(named(calls, "scripts.restageAndBlock")).toHaveLength(0);
    });

    it("blocks the group on an ordinary failure", async () => {
      const { processor, calls } = recordingProcessor({ process: failing });

      await processor["processWithRetries"](spent);

      expect(named(calls, "scripts.retryRestage")).toHaveLength(0);
      expect(named(calls, "scripts.restageAndBlock")).toHaveLength(1);
    });

    /** @scenario "An overloaded server does not spend a group's ordinary retry budget" */
    it("blocks the group once the overload budget is spent too", async () => {
      const { processor, calls } = recordingProcessor({ retryAfterMs: 0, process: failing });

      await processor["processWithRetries"]({
        ...dispatched,
        groupAttempt: JOB_RETRY_CONFIG.maxOverloadedAttempts,
      });

      expect(named(calls, "scripts.retryRestage")).toHaveLength(0);
      expect(named(calls, "scripts.restageAndBlock")).toHaveLength(1);
    });
  });

  describe("when the job spent its earlier retries on an overloaded server", () => {
    const failing = async () => {
      throw new Error("handler failed");
    };
    const afterOverload = ({
      attempt,
      overloadAttempts,
    }: {
      attempt: number;
      overloadAttempts: number;
    }) => ({
      ...dispatched,
      jobDataJson: JSON.stringify({
        id: "job-1",
        groupId: GROUP,
        __jobName: "job",
        __attempt: attempt,
        __overloadAttempts: overloadAttempts,
      }),
      groupAttempt: attempt,
    });
    const encodedRetry = (calls: unknown[]) =>
      named(calls, "blob.encode").map(
        (call) => (call as [string, [{ jobData: Record<string, unknown> }]])[1][0].jobData,
      );

    /** @scenario "An ordinary failure after an overload spell still gets its ordinary budget" */
    it("re-stages an ordinary failure instead of blocking the group", async () => {
      const { processor, calls } = recordingProcessor({ process: failing });

      await processor["processWithRetries"](afterOverload({ attempt: 30, overloadAttempts: 29 }));

      expect(named(calls, "scripts.retryRestage")).toHaveLength(1);
      expect(named(calls, "scripts.restageAndBlock")).toHaveLength(0);
      expect(encodedRetry(calls)).toEqual([
        expect.objectContaining({ __attempt: 31, __overloadAttempts: 29 }),
      ]);
    });

    /** @scenario "An ordinary failure after an overload spell still gets its ordinary budget" */
    it("blocks the group once the ordinary rungs on top are spent", async () => {
      const { processor, calls } = recordingProcessor({ process: failing });

      await processor["processWithRetries"](afterOverload({ attempt: 54, overloadAttempts: 29 }));

      expect(named(calls, "scripts.retryRestage")).toHaveLength(0);
      expect(named(calls, "scripts.restageAndBlock")).toHaveLength(1);
    });

    /** @scenario "An ordinary failure after an overload spell still gets its ordinary budget" */
    it("never retries an ordinary failure past the overload budget", async () => {
      const { processor, calls } = recordingProcessor({ process: failing });

      await processor["processWithRetries"](
        afterOverload({ attempt: JOB_RETRY_CONFIG.maxOverloadedAttempts, overloadAttempts: 50 }),
      );

      expect(named(calls, "scripts.retryRestage")).toHaveLength(0);
      expect(named(calls, "scripts.restageAndBlock")).toHaveLength(1);
    });

    it("counts another overload retry in the job it re-stages", async () => {
      const { processor, calls } = recordingProcessor({ retryAfterMs: 0, process: failing });

      await processor["processWithRetries"](afterOverload({ attempt: 30, overloadAttempts: 29 }));

      expect(encodedRetry(calls)).toEqual([
        expect.objectContaining({ __attempt: 31, __overloadAttempts: 30 }),
      ]);
    });
  });

  it("still reads the counter itself when the claim carried none", async () => {
    const { processor, calls } = recordingProcessor({});

    await processor["processWithRetries"](dispatched);

    expect(named(calls, "redis.get")).toEqual([
      ["redis.get", [`{test/gq/characterize}:gq:group:${GROUP}:attempt`]],
    ]);
  });
});
