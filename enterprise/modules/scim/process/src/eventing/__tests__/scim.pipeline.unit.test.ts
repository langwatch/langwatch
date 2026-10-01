// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Spec: specs/identity/scim-request-log.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { scimServer } from "../../scim.server.ts";
import { SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME } from "../scim-request-log-retention.intent.ts";
import { SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS } from "../scim-request-log-retention.process.ts";
import {
  buildScimMaintenance,
  SCIM_MAINTENANCE_PIPELINE_NAME,
  scimEventing,
} from "../scim.pipeline.ts";

const HOUR_MS = 60 * 60 * 1000;

describe("given SCIM's eventing declaration", () => {
  describe("when the module is declared", () => {
    /** @scenario "The worker runs the request log's retention sweep on a schedule" */
    it("carries the six-hourly retention sweep onto the installable module", () => {
      expect(scimServer.eventing?.pipeline.split(", ")).toContain(SCIM_MAINTENANCE_PIPELINE_NAME);
      expect(scimEventing.pipeline).toBe(SCIM_MAINTENANCE_PIPELINE_NAME);
      expect(SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS).toBe(6 * HOUR_MS);
    });
  });

  describe("when its six-hourly schedule fires", () => {
    /** @scenario "The worker runs the request log's retention sweep on a schedule" */
    it("runs the retention sweep once through the app and prunes its bookkeeping", async () => {
      const sweepExpiredRequests = vi.fn(async (_input: { now: Instant }) => 3);
      const processStore = InMemoryProcessStore.createForTesting();
      const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");
      const definition = buildScimMaintenance({
        participation: "consume",
        repositories: undefined,
        app: { sweepExpiredRequests },
        processStore,
      });
      const process = definition.processManagers.get(SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME);
      if (!process) throw new Error("the declaration built no retention process manager");

      await process.config.intents!.sweep!.run(
        { scheduledFor: 0 },
        {
          processName: SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
          projectId: "global",
          processKey: "global",
          tenantId: "global",
          messageKey: `${SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME}:0`,
          attempt: 1,
        },
      );

      expect(sweepExpiredRequests).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
        processName: SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
      });
    });
  });
});
