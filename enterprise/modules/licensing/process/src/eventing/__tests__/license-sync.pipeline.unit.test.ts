/** Spec: specs/self-hosting/connected-services/license-sync.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { licensingServer } from "../../licensing.server.ts";
import { LICENSE_SYNC_PROCESS_NAME } from "../license-sync.intent.ts";
import {
  buildLicenseSync,
  LICENSE_SYNC_PIPELINE_NAME,
  licenseSyncEventing,
} from "../license-sync.pipeline.ts";
import {
  LICENSE_SYNC_FIRST_DELAY_MS,
  LICENSE_SYNC_INTERVAL_MS,
  licenseSyncWake,
} from "../license-sync.process.ts";

const BOOTED_AT = 1_700_000_000_000;
const MINUTE_MS = 60 * 1000;

function wakeAt({ at, lastSyncAt }: { at: number; lastSyncAt: number | null }) {
  const sync = vi.fn((messageKey: string, payload: { scheduledFor: number }) => ({
    messageKey,
    intentType: "sync",
    payload,
  }));
  const evolution = licenseSyncWake({ bootedAt: BOOTED_AT })(
    { lastSyncAt },
    { at, now: at, key: LICENSE_SYNC_PROCESS_NAME, projectId: "__global__", intents: { sync } },
  );
  return { evolution, sync };
}

describe("given the license sync's eventing declaration", () => {
  describe("when the module is declared", () => {
    it("carries the daily sync onto the installable module", () => {
      expect(licensingServer.eventing).toBe(licenseSyncEventing);
      expect(licenseSyncEventing.pipeline).toBe(LICENSE_SYNC_PIPELINE_NAME);
    });
  });

  describe("when the process has just come up", () => {
    it("waits two minutes before the first sync", () => {
      expect(wakeAt({ at: BOOTED_AT + MINUTE_MS, lastSyncAt: null }).sync).not.toHaveBeenCalled();
      expect(
        wakeAt({ at: BOOTED_AT + LICENSE_SYNC_FIRST_DELAY_MS, lastSyncAt: null }).sync,
      ).toHaveBeenCalledTimes(1);
    });

    it("syncs after a restart rather than waiting out the day", () => {
      const lastSyncAt = BOOTED_AT - MINUTE_MS;
      expect(
        wakeAt({ at: BOOTED_AT + LICENSE_SYNC_FIRST_DELAY_MS, lastSyncAt }).sync,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("when it has synced since it came up", () => {
    it("syncs again once a day has passed, and not before", () => {
      const lastSyncAt = BOOTED_AT + LICENSE_SYNC_FIRST_DELAY_MS;
      expect(wakeAt({ at: lastSyncAt + 60 * MINUTE_MS, lastSyncAt }).sync).not.toHaveBeenCalled();
      const due = wakeAt({ at: lastSyncAt + LICENSE_SYNC_INTERVAL_MS, lastSyncAt });
      expect(due.sync).toHaveBeenCalledTimes(1);
      expect(due.evolution.state.lastSyncAt).toBe(lastSyncAt + LICENSE_SYNC_INTERVAL_MS);
    });
  });

  describe("when the sync intent runs", () => {
    it("syncs every licensed organization through the app and prunes its bookkeeping", async () => {
      const syncLicenses = vi.fn(async () => undefined);
      const processStore = InMemoryProcessStore.createForTesting();
      const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");
      const definition = buildLicenseSync({
        participation: "consume",
        repositories: undefined,
        app: { syncLicenses },
        processStore,
        bootedAt: BOOTED_AT,
      });
      const process = definition.processManagers.get(LICENSE_SYNC_PROCESS_NAME);
      if (!process) throw new Error("the declaration built no license sync process manager");

      await process.config.intents!.sync!.run(
        { scheduledFor: 0 },
        {
          processName: LICENSE_SYNC_PROCESS_NAME,
          projectId: "global",
          processKey: "global",
          tenantId: "global",
          messageKey: `${LICENSE_SYNC_PROCESS_NAME}:0`,
          attempt: 1,
        },
      );

      expect(syncLicenses).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
        processName: LICENSE_SYNC_PROCESS_NAME,
      });
    });

    it("throws a pass that failed, so the outbox retries it", async () => {
      const definition = buildLicenseSync({
        participation: "consume",
        repositories: undefined,
        app: { syncLicenses: async () => Promise.reject(new Error("host down")) },
        processStore: InMemoryProcessStore.createForTesting(),
      });
      const process = definition.processManagers.get(LICENSE_SYNC_PROCESS_NAME);

      await expect(
        process!.config.intents!.sync!.run(
          { scheduledFor: 0 },
          {
            processName: LICENSE_SYNC_PROCESS_NAME,
            projectId: "global",
            processKey: "global",
            tenantId: "global",
            messageKey: `${LICENSE_SYNC_PROCESS_NAME}:0`,
            attempt: 1,
          },
        ),
      ).rejects.toThrow("host down");
    });
  });
});
