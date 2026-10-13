// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: enterprise/modules/governance/specs/governance-deploy-steps.feature
 */
import { PULLED_USAGE_EVENT_TYPES } from "@langwatch/enterprise-governance-contract";
import type { ReplayEventSource } from "@langwatch/eventing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GOVERNANCE_COST_CHARGE_PROJECTION_NAME } from "../../eventing/governance-cost-charge.projection.ts";
import { bootGovernanceWorker, runStep } from "./governance-deploy-steps.fixture.ts";

const STEP_ID = "governance:replay-cost-charges";
const LANE = GOVERNANCE_COST_CHARGE_PROJECTION_NAME;
const DEPLOYED_AT = "2026-10-08T09:30:00.000Z";
const THIRTY_DAYS_BEFORE_MS = Date.parse("2026-09-08T09:30:00.000Z");

type Discovery = { eventTypes: readonly string[]; sinceMs?: number };

/** Governance's pulled usage log, empty of aggregates, recording what the engine discovers. */
class RecordingPulledUsageLog implements ReplayEventSource {
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

async function replayOnce() {
  const log = new RecordingPulledUsageLog();
  const { runtime, step } = await bootGovernanceWorker({ replaySource: log });
  try {
    const declared = step(STEP_ID);
    const { report } = await runStep({ step: declared });
    return { log, declared, report };
  } finally {
    await runtime.stop();
  }
}

describe("given a worker installing governance over its pulled usage log", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(DEPLOYED_AT));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "The cost charge replay is a background replay of the charge lane that waits for the old writers" */
  it("declares a background replay of the charge lane needing the old writers gone", async () => {
    const { declared, report } = await replayOnce();

    expect(declared).toMatchObject({
      kind: "data",
      mode: "background",
      needsOldWritersGone: true,
    });
    expect(report).toMatchObject({ lane: LANE, aggregatesReplayed: 0 });
  });

  /** @scenario "The cost charge replay starts thirty days before the deploy" */
  it("discovers pulled usage stored since thirty days before the deploy", async () => {
    const { log } = await replayOnce();

    expect(log.discoveries[0]?.sinceMs).toBe(THIRTY_DAYS_BEFORE_MS);
    expect(log.discoveries[0]?.eventTypes).toEqual(
      expect.arrayContaining([
        PULLED_USAGE_EVENT_TYPES.OBSERVED,
        PULLED_USAGE_EVENT_TYPES.RETRACTED,
      ]),
    );
  });
});
