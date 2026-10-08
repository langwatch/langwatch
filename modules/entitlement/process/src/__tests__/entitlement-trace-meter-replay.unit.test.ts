/**
 * @vitest-environment node
 * Spec: modules/entitlement/specs/usage.feature
 */
import { USAGE_PIPELINE_NAME } from "@langwatch/entitlement-contract";
import {
  defineAggregate,
  definePipeline,
  EventSourcing,
  InMemoryProcessStore,
  type ReplayEventSource,
  ReplayService,
} from "@langwatch/eventing";
import { testEventSchema } from "@langwatch/eventing/testing";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { EntitlementModule } from "../app/entitlement.app.ts";
import { entitlementProcessModule } from "../entitlement.module.ts";
import {
  TRACE_METER_EVENT,
  TRACE_METER_PROJECTION_NAME,
} from "../eventing/trace-meter.projection.ts";

const STEP_ID = "entitlement:seed-trace-meter";
const SINCE = "2026-09-01T00:00:00.000Z";

type Discovery = { eventTypes: readonly string[]; sinceMs?: number };

/** Trace's span log, empty, recording what the replay engine asks it to discover. */
class RecordingSpanLog implements ReplayEventSource {
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

/** Trace's span pipeline as a stand-in owner, as a worker installing both registers it. */
function traceStandIn() {
  return definePipeline({ name: "trace_processing", aggregate: defineAggregate({ type: "trace" }) })
    .withEvents([testEventSchema(TRACE_METER_EVENT.type, TRACE_METER_EVENT.data)])
    .build();
}

/** A worker installing entitlement whose eventing replays over the recording log. */
async function bootWorker({ log }: { log: RecordingSpanLog }) {
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
  eventing.register(traceStandIn());
  const stores = memoryStores();
  return bootInstalledProcess({
    role: "worker",
    modules: [entitlementProcessModule],
    config: { entitlement: { isSaas: false } },
    members: {
      tier: stores.tier,
      order: [...stores.order, "eventing"],
      read: (name: string) => (name === "eventing" ? eventing : stores.read(name)),
      close: async () => void 0,
    },
    peers: Object.values(EntitlementModule.dependencies).map((token) =>
      testPeer({ token, instance: createApiFixture() }),
    ),
  });
}

describe("given a worker installing entitlement over trace's span log", () => {
  /** @scenario "The trace meter is seeded at deploy by replaying trace's spans" */
  it("declares the seed step, which replays the trace meter lane from the first of September", async () => {
    const log = new RecordingSpanLog();
    const runtime = await bootWorker({ log });

    try {
      const step = runtime.migrationSteps(isMigrationStep).find(({ id }) => id === STEP_ID);
      expect(step).toMatchObject({ kind: "data", mode: "background" });

      const report = await step?.run({
        checkpoint: { resumeFrom: null, save: async () => void 0 },
        dryRun: false,
        signal: new AbortController().signal,
      });

      expect(report).toMatchObject({
        lane: `${USAGE_PIPELINE_NAME}.${TRACE_METER_PROJECTION_NAME}`,
        aggregatesReplayed: 0,
      });
      expect(log.discoveries).toEqual([
        { eventTypes: [SPAN_RECEIVED_EVENT_TYPE], sinceMs: Date.parse(SINCE) },
      ]);
    } finally {
      await runtime.stop();
    }
  });
});
