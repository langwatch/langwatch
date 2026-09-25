/** Pins every outcome of a claimed job as the ordered calls it makes; see ADR-090 and ADR-080. */

import { Redis as IORedis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { EnvelopeBlobLifecycle } from "../envelopeBlobLifecycle.ts";
import { NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
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

  const scriptAnswers: [keyof GroupStagingScripts, () => unknown][] = [
    ["complete", () => undefined],
    ["drainGroupReady", () => scenario.siblings ?? []],
    ["refreshActiveKey", () => undefined],
    ["restageAndBlock", () => undefined],
    ["retryRestage", () => true],
    ["recordGroupFailure", () => scenario.failStreak ?? 1],
    ["clearGroupFailures", () => undefined],
    ["stage", () => undefined],
    ["discardClaim", () => undefined],
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
    failures: { classify: () => ({ retryable: scenario.retryable ?? true }) },
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

  it("drops a job whose value cannot be decoded", async () => {
    const calls = await runClaimed({
      decode: async () => {
        throw new Error("garbled");
      },
    });
    expect(calls).toMatchSnapshot();
  });
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
