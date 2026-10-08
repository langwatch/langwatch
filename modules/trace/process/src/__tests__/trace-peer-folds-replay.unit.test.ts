/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-topic-names.feature
 * Spec: modules/trace/specs/trace-annotations.feature
 */
import {
  ANNOTATION_CREATED_EVENT_TYPE,
  ANNOTATION_DELETED_EVENT_TYPE,
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  ANNOTATION_UPDATED_EVENT_TYPE,
} from "@langwatch/annotation-contract";
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
import { TOPIC_CLUSTERING_EVENT_TYPES } from "@langwatch/topic-contract";
import { isMigrationStep, PROJECTION_REPLAY_FROM_START } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { TraceModule } from "../app/trace.app.ts";
import {
  annotationStandIn,
  topicStandIn,
} from "../eventing/__tests__/trace-peer-folds.fixtures.ts";
import {
  TRACE_ANNOTATION_SCORES_LANE,
  TRACE_ANNOTATIONS_LANE,
} from "../eventing/trace-annotations.pipeline.ts";
import { TRACE_TOPIC_NAMES_LANE } from "../eventing/trace-topic-names.pipeline.ts";
import { traceProcessModule } from "../trace.module.ts";

type Discovery = { eventTypes: readonly string[]; sinceMs?: number };

/** The owners' logs, empty, recording what the replay engine asks them to discover. */
class RecordingOwnerLog implements ReplayEventSource {
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

function logStandIn() {
  return definePipeline({ name: "log_records", aggregate: defineAggregate({ type: "log_record" }) })
    .withEvents([
      testEventSchema(CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE, canonicalLogRecordSchema),
    ])
    .build();
}

/** A worker installing trace beside its peer folds' owners, replaying over the recording log. */
async function bootWorker({ log }: { log: RecordingOwnerLog }) {
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
  eventing.register(topicStandIn());
  eventing.register(annotationStandIn());
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

const STEPS = [
  {
    scenario: "Trace's topic name fold is replayed over every topic model at deploy",
    id: "trace:fold-topic-names",
    lane: TRACE_TOPIC_NAMES_LANE,
    eventTypes: [TOPIC_CLUSTERING_EVENT_TYPES.TOPICS_RECORDED],
  },
  {
    scenario: "Trace's annotation folds are replayed over every annotation fact at deploy",
    id: "trace:fold-annotations",
    lane: TRACE_ANNOTATIONS_LANE,
    eventTypes: [
      ANNOTATION_CREATED_EVENT_TYPE,
      ANNOTATION_UPDATED_EVENT_TYPE,
      ANNOTATION_DELETED_EVENT_TYPE,
    ],
  },
  {
    scenario: "Trace's annotation folds are replayed over every annotation fact at deploy",
    id: "trace:fold-annotation-scores",
    lane: TRACE_ANNOTATION_SCORES_LANE,
    eventTypes: [ANNOTATION_SCORE_DEFINED_EVENT_TYPE, ANNOTATION_SCORE_RENAMED_EVENT_TYPE],
  },
] as const;

describe("given a worker installing trace over its peer folds' owner logs", () => {
  /**
   * @scenario "Trace's topic name fold is replayed over every topic model at deploy"
   * @scenario "Trace's annotation folds are replayed over every annotation fact at deploy"
   */
  it.each(STEPS)(
    "declares $id, which replays $lane from the start once old writers are gone",
    async ({ id, lane, eventTypes }) => {
      const log = new RecordingOwnerLog();
      const runtime = await bootWorker({ log });

      try {
        const step = runtime.migrationSteps(isMigrationStep).find((s) => s.id === id);
        expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });

        const report = await step?.run({
          checkpoint: { resumeFrom: null, save: async () => void 0 },
          dryRun: false,
          signal: new AbortController().signal,
        });

        expect(report).toMatchObject({ lane, aggregatesReplayed: 0 });
        expect(log.discoveries).toEqual([
          { eventTypes, sinceMs: Date.parse(PROJECTION_REPLAY_FROM_START) },
        ]);
      } finally {
        await runtime.stop();
      }
    },
  );
});
