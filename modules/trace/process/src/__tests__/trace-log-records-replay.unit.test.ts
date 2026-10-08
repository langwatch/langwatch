/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-log-record-storage.feature
 */
import {
  defineAggregate,
  definePipeline,
  EventSourcing,
  InMemoryProcessStore,
  type ReplayEventSource,
  ReplayService,
} from "@langwatch/eventing";
import { testEventSchema } from "@langwatch/eventing/testing";
import {
  CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
  canonicalLogRecordSchema,
} from "@langwatch/log-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { isMigrationStep, PROJECTION_REPLAY_FROM_START } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { TraceModule } from "../app/trace.app.ts";
import { TRACE_LOG_RECORD_STORAGE_LANE } from "../eventing/trace-log-records.pipeline.ts";
import { traceProcessModule } from "../trace.module.ts";

const STEP_ID = "trace:map-log-records";

type Discovery = { eventTypes: readonly string[]; sinceMs?: number };

/** Log's record log, empty, recording what the replay engine asks it to discover. */
class RecordingLogRecordLog implements ReplayEventSource {
  readonly discoveries: Discovery[] = [];

  async discoverAffectedAggregates(input: Discovery) {
    this.discoveries.push({ eventTypes: input.eventTypes, sinceMs: input.sinceMs });
    return [];
  }
  async countEventsForAggregates() {
    return 0;
  }
  async getBoundedCutoffs() {
    return { cutoffs: new Map(), occurredAtBounds: undefined };
  }
  async streamEventsForAggregates() {
    return { eventsApplied: 0 };
  }
  async loadAggregateEvents() {
    return [];
  }
}

/** Log's record pipeline as a stand-in owner, as a worker installing both registers it. */
function logStandIn() {
  return definePipeline({ name: "log_records", aggregate: defineAggregate({ type: "log_record" }) })
    .withEvents([
      testEventSchema(CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE, canonicalLogRecordSchema),
    ])
    .build();
}

/** A worker installing trace whose eventing replays over the recording log. */
async function bootWorker({ log }: { log: RecordingLogRecordLog }) {
  const eventing = new EventSourcing({
    enabled: false,
    processStore: InMemoryProcessStore.createForTesting(),
    replayEngine: () => ({
      service: new ReplayService({
        eventSource: log,
        redis: memoryRedisDouble({
          script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
        }),
      }),
      close: async () => void 0,
    }),
  });
  eventing.register(logStandIn());
  const stores = memoryStores();
  return bootInstalledProcess({
    role: "worker",
    modules: [traceProcessModule],
    config: { trace: { tokenizer: {}, publicBaseUrl: "http://localhost:5560" } },
    members: {
      tier: stores.tier,
      order: [...stores.order, "eventing"],
      read: (name: string) => (name === "eventing" ? eventing : stores.read(name)),
      close: async () => void 0,
    },
    peers: Object.values(TraceModule.dependencies).map((token) =>
      testPeer({ token, instance: createApiFixture() }),
    ),
  });
}

describe("given a worker installing trace over log's record log", () => {
  /** @scenario "Trace's log record lane is replayed over every log record at deploy" */
  it("declares the map step, which replays the log record lane from the start once old writers are gone", async () => {
    const log = new RecordingLogRecordLog();
    const runtime = await bootWorker({ log });

    try {
      const step = runtime.migrationSteps(isMigrationStep).find(({ id }) => id === STEP_ID);
      expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });

      const report = await step?.run({
        checkpoint: { resumeFrom: null, save: async () => void 0 },
        dryRun: false,
        signal: new AbortController().signal,
      });

      expect(report).toMatchObject({
        lane: TRACE_LOG_RECORD_STORAGE_LANE,
        aggregatesReplayed: 0,
      });
      expect(log.discoveries).toEqual([
        {
          eventTypes: [CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE],
          sinceMs: Date.parse(PROJECTION_REPLAY_FROM_START),
        },
      ]);
    } finally {
      await runtime.stop();
    }
  });
});
