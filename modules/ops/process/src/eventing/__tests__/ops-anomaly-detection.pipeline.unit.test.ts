/** Spec: modules/ops/specs/event-queue-anomaly-detection.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { Anomaly } from "@langwatch/ops-contract";
import { describe, expect, it, vi } from "vitest";

import { opsServer } from "../../ops.server.ts";
import { MemoryAnomalyRateTrackerRepository } from "../../repositories/memory/memory.anomaly-rate-tracker.repository.ts";
import { MemoryAnomalyStateRepository } from "../../repositories/memory/memory.anomaly-state.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { AnomalyDetectorService } from "../../services/anomaly-detector.service.ts";
import {
  ANOMALY_DETECTION_PROCESS_NAME,
  type AnomalyDetectionTickResult,
} from "../ops-anomaly-detection.intent.ts";
import {
  ANOMALY_DETECTION_PIPELINE_NAME,
  anomalyDetectionEventing,
  buildAnomalyDetection,
} from "../ops-anomaly-detection.pipeline.ts";
import { anomalyDetectionWake } from "../ops-anomaly-detection.process.ts";

const NOW = Date.parse("2026-09-23T12:00:00Z");

/** One tenant running at a hundred times its cached baseline, sustained. */
async function runawayTenant() {
  const store = MemoryOpsStore.create();
  const rateTracker = MemoryAnomalyRateTrackerRepository.create({ store, now: () => NOW });
  const anomalyState = MemoryAnomalyStateRepository.create({ store });
  await rateTracker.setCachedBaseline({ tenantId: "proj_runaway", baseline: 5 });
  await rateTracker.record("proj_runaway", 10_000);
  const notify = vi.fn<(anomaly: Anomaly) => Promise<void>>(async () => undefined);
  const detector = AnomalyDetectorService.create({
    rateTracker,
    anomalyState,
    hardTierAlerts: { notify },
  });
  return { anomalyState, notify, detector };
}

function built(detectAnomalies: () => Promise<AnomalyDetectionTickResult>) {
  const processStore = InMemoryProcessStore.createForTesting();
  const definition = buildAnomalyDetection({
    participation: "consume",
    repositories: undefined,
    app: { detectAnomalies },
    processStore,
  });
  const process = definition.processManagers.get(ANOMALY_DETECTION_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no anomaly detection process manager");
  return { definition, process };
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.detect!.run(
    { scheduledFor: at },
    {
      processName: ANOMALY_DETECTION_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `detect:${at}`,
      attempt: 1,
    },
  );
}

function wake(at: number) {
  return anomalyDetectionWake(
    { lastDetectionAt: null },
    {
      at,
      now: at,
      key: ANOMALY_DETECTION_PROCESS_NAME,
      projectId: "__global__",
      intents: {
        detect: (messageKey, payload) => ({ messageKey, intentType: "detect", payload }),
      },
    },
  );
}

describe("given ops's anomaly detection declaration", () => {
  /** @scenario "Anomaly detection ticks once a minute as a scheduled process" */
  it("is installed with the module and wakes every sixty seconds", () => {
    const { definition, process } = built(async () => ({ surfaced: 0, cleared: 0 }));

    expect(anomalyDetectionEventing.pipeline).toBe(ANOMALY_DETECTION_PIPELINE_NAME);
    expect(opsServer.eventing?.pipeline.split(", ")).toContain(ANOMALY_DETECTION_PIPELINE_NAME);
    expect(definition.metadata.name).toBe(ANOMALY_DETECTION_PIPELINE_NAME);
    expect(process.config.schedule?.everyMs).toBe(60_000);
  });

  /** @scenario "Anomaly detection ticks once a minute as a scheduled process" */
  it("asks for one detection per wake, keyed by the wake", () => {
    const first = wake(NOW);
    const redelivered = wake(NOW);

    expect(first.intents).toHaveLength(1);
    expect(first.intents?.[0]?.messageKey).toBe(redelivered.intents?.[0]?.messageKey);
    expect(wake(NOW + 60_000).intents?.[0]?.messageKey).not.toBe(first.intents?.[0]?.messageKey);
  });

  describe("when the same detection is delivered twice", () => {
    /** @scenario "A redelivered detection surfaces a runaway tenant once" */
    it("records the anomaly once and pages once", async () => {
      const { anomalyState, notify, detector } = await runawayTenant();
      const { process } = built(() => detector.tick());

      await deliver(process, NOW);
      const afterFirst = await anomalyState.findAll();
      await deliver(process, NOW);

      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0]).toMatchObject({ tenantId: "proj_runaway", tier: "hard" });
      expect(await anomalyState.findAll()).toEqual(afterFirst);
      expect(notify).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a detection tick fails", () => {
    /** @scenario "A failed detection tick waits for the next wake" */
    it("settles the intent and runs again on the next wake", async () => {
      const detect = vi
        .fn<() => Promise<{ surfaced: number; cleared: number }>>()
        .mockRejectedValueOnce(new Error("redis unavailable"))
        .mockResolvedValue({ surfaced: 0, cleared: 0 });
      const { process } = built(detect);

      await expect(deliver(process, NOW)).resolves.toBeUndefined();
      await deliver(process, NOW + 60_000);

      expect(detect).toHaveBeenCalledTimes(2);
    });
  });
});
