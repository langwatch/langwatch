/** Spec: modules/ops/specs/upgrade-alerts.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { buildUpgradeAlerts } from "../ops-upgrade-alerts.pipeline.ts";
import {
  UPGRADE_ALERTS_INTERVAL_MS,
  UPGRADE_ALERTS_PROCESS_NAME,
  runUpgradeAlertsCheck,
  upgradeAlertsWake,
} from "../ops-upgrade-alerts.process.ts";

const AT = Date.parse("2026-10-09T12:00:00Z");

function wake(lastCheckedAt: number | null) {
  return upgradeAlertsWake(
    { lastCheckedAt },
    {
      at: AT,
      now: AT,
      key: UPGRADE_ALERTS_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({
        check: (messageKey, payload) => ({ messageKey, intentType: "check", payload }),
      }),
    },
  );
}

describe("the upgrade alert schedule", () => {
  /** @scenario "Each wake checks the window since the previous wake" */
  it("asks for one check from the previous wake to this one, keyed by this wake", () => {
    const evolution = wake(AT - 90 * 60_000);

    expect(evolution.state).toEqual({ lastCheckedAt: AT });
    expect(evolution.intents).toEqual([
      {
        messageKey: `check:${AT}`,
        intentType: "check",
        payload: { since: AT - 90 * 60_000, until: AT },
      },
    ]);
  });

  it("covers one interval on the first wake", () => {
    expect(wake(null).intents?.[0]?.payload).toEqual({
      since: AT - UPGRADE_ALERTS_INTERVAL_MS,
      until: AT,
    });
  });
});

describe("the upgrade alert check", () => {
  it("survives a failed check and still prunes its week-old bookkeeping", async () => {
    const deleteDispatchedBefore = vi.fn(async () => 0);
    const check = vi.fn(async () => {
      throw new Error("mail down");
    });

    await runUpgradeAlertsCheck({ check, deleteDispatchedBefore })({ since: 0, until: AT });

    expect(deleteDispatchedBefore).toHaveBeenCalledWith({
      processName: UPGRADE_ALERTS_PROCESS_NAME,
      before: AT - 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("builds a pipeline that schedules the check hourly", () => {
    const pipeline = buildUpgradeAlerts({
      participation: "consume",
      repositories: undefined,
      app: { checkUpgradeAlerts: async () => [] },
      processStore: InMemoryProcessStore.createForTesting(),
    });

    expect(pipeline.processManagers.get(UPGRADE_ALERTS_PROCESS_NAME)?.config.schedule).toEqual({
      everyMs: 60 * 60 * 1000,
    });
  });
});
