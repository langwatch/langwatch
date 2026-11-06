// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The daily usage sync's schedule: hourly wakes, one sync after each 05:00 UTC.
 * @see enterprise/modules/nurturing/specs/organization-usage.feature
 */
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { buildOrganizationUsagePipeline } from "../nurturing-organization-usage.pipeline.ts";
import {
  ORGANIZATION_USAGE_PROCESS_NAME,
  organizationUsageWake,
  type OrganizationUsageScheduleState,
  runOrganizationUsageSync,
} from "../nurturing-organization-usage.process.ts";

const at = (iso: string) => Date.parse(iso);

function wake(state: OrganizationUsageScheduleState, iso: string) {
  const moment = at(iso);
  return organizationUsageWake(state, {
    at: moment,
    now: moment,
    key: ORGANIZATION_USAGE_PROCESS_NAME,
    projectId: "__global__",
    intent: intentAccessorOf({
      sync: (messageKey, payload) => ({ messageKey, intentType: "sync", payload }),
    }),
  });
}

describe("the organization usage sync schedule", () => {
  describe("given a process that has never woken", () => {
    it("takes a baseline and asks for no sync", () => {
      const evolution = wake({ lastSyncAt: null }, "2026-11-06T07:00:00Z");

      expect(evolution.state).toEqual({ lastSyncAt: at("2026-11-06T07:00:00Z") });
      expect(evolution.intents).toBeUndefined();
    });
  });

  describe("given the last sync went yesterday", () => {
    const state = { lastSyncAt: at("2026-11-05T05:10:00Z") };

    /** @scenario The sync waits for 05:00 UTC */
    it("asks for nothing at 04:59 UTC", () => {
      expect(wake(state, "2026-11-06T04:59:00Z").intents).toBeUndefined();
    });

    it("asks for one sync at 05:00 UTC", () => {
      expect(wake(state, "2026-11-06T05:00:00Z").intents).toHaveLength(1);
    });

    /** @scenario A sync that already ran today sends nothing more */
    it("keys the day's sync once, and asks for none on the next wake", () => {
      const first = wake(state, "2026-11-06T05:10:00Z");
      const redelivered = wake(state, "2026-11-06T05:40:00Z");

      expect(first.intents?.[0]?.messageKey).toBe(redelivered.intents?.[0]?.messageKey);
      expect(wake(first.state, "2026-11-06T06:10:00Z").intents).toBeUndefined();
    });
  });
});

describe("the organization usage sync tick", () => {
  const scheduledFor = at("2026-11-06T05:10:00Z");

  it("syncs for the scheduled day and prunes its week-old bookkeeping", async () => {
    const sync = vi.fn(async () => {});
    const deleteDispatchedBefore = vi.fn(async () => 0);
    const now = at("2026-11-06T05:20:00Z");

    await runOrganizationUsageSync({ sync, deleteDispatchedBefore, now: () => now })({
      scheduledFor,
    });

    expect(sync).toHaveBeenCalledWith({ now: scheduledFor });
    expect(deleteDispatchedBefore).toHaveBeenCalledWith({
      processName: ORGANIZATION_USAGE_PROCESS_NAME,
      before: now - 7 * 24 * 60 * 60 * 1000,
    });
  });

  it("fails when the sync did, so the outbox retries it", async () => {
    const deleteDispatchedBefore = vi.fn(async () => 0);

    await expect(
      runOrganizationUsageSync({
        sync: async () => {
          throw new Error("one organization was not synced");
        },
        deleteDispatchedBefore,
        now: () => scheduledFor,
      })({ scheduledFor }),
    ).rejects.toThrow("one organization was not synced");
    expect(deleteDispatchedBefore).toHaveBeenCalledTimes(1);
  });

  it("builds a pipeline that schedules the sync hourly", () => {
    const pipeline = buildOrganizationUsagePipeline({
      sync: async () => {},
      deleteDispatchedBefore: async () => 0,
      now: () => 0,
    });

    expect(pipeline.processManagers.get(ORGANIZATION_USAGE_PROCESS_NAME)?.config.schedule).toEqual(
      { everyMs: 60 * 60 * 1000 },
    );
  });
});
