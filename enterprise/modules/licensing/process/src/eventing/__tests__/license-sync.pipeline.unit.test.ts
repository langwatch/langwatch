/** Spec: specs/self-hosting/connected-services/license-sync.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { ORGANIZATION_SIGNED_UP_EVENT_TYPE } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { licensingProcessModule } from "../../licensing.module.ts";
import { LICENSE_SYNC_PROCESS_NAME } from "../license-sync.intent.ts";
import {
  buildLicenseSync,
  CONFIGURED_LICENSE_ON_SIGN_UP,
  configuredLicenseOnSignUp,
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
  const sync = vi.fn((messageKey: string, payload: JsonValue) => ({
    messageKey,
    intentType: "sync",
    payload,
  }));
  const evolution = licenseSyncWake({ bootedAt: BOOTED_AT })(
    { lastSyncAt },
    {
      at,
      now: at,
      key: LICENSE_SYNC_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({ sync }),
    },
  );
  return { evolution, sync };
}

describe("given the license sync's eventing declaration", () => {
  describe("when the module is declared", () => {
    it("carries the daily sync onto the installable module", () => {
      expect(licensingProcessModule.eventing).toBe(licenseSyncEventing);
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
        app: { syncLicenses, activateConfiguredLicense: vi.fn() },
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
        app: {
          syncLicenses: async () => Promise.reject(new Error("host down")),
          activateConfiguredLicense: vi.fn(),
        },
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

  describe("when an organization signs up", () => {
    /** @scenario "an activation code on a fresh install waits for the first organization" */
    it("asks the app to redeem a configured activation code", async () => {
      const activateConfiguredLicense = vi.fn(async () => ({ outcome: "not_configured" as const }));
      const definition = buildLicenseSync({
        participation: "consume",
        repositories: undefined,
        app: { syncLicenses: vi.fn(), activateConfiguredLicense },
        processStore: InMemoryProcessStore.createForTesting(),
      });
      const subscriber = configuredLicenseOnSignUp({ activateConfiguredLicense });

      await subscriber.handle(
        {
          tenantId: "org-1",
          organizationId: "org-1",
          userId: "user-1",
          occurredAt: 1,
          organizationName: "ACME",
        },
        { tenantId: "org-1", aggregateId: "org-1", occurredAt: 1 },
      );

      expect(subscriber.eventType).toBe(ORGANIZATION_SIGNED_UP_EVENT_TYPE);
      expect(definition.globalProjections?.map(({ name }) => name)).toContain(
        `${LICENSE_SYNC_PIPELINE_NAME}.${CONFIGURED_LICENSE_ON_SIGN_UP}`,
      );
      expect(activateConfiguredLicense).toHaveBeenCalledTimes(1);
    });
  });
});
