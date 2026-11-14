/** Spec: specs/identity/admin-impersonation.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { authProcessModule } from "../../auth.module.ts";
import { IMPERSONATION_EXPIRY_PROCESS_NAME } from "../impersonation-expiry.intent.ts";
import {
  IMPERSONATION_MAINTENANCE_PIPELINE_NAME,
  buildImpersonationMaintenance,
} from "../impersonation-expiry.pipeline.ts";
import { IMPERSONATION_EXPIRY_INTERVAL_MS } from "../impersonation-expiry.process.ts";

function built() {
  const processStore = InMemoryProcessStore.createForTesting();
  const expireLapsedImpersonations = vi.fn(async () => ({ expired: 2 }));
  const definition = buildImpersonationMaintenance({
    participation: "consume",
    repositories: undefined,
    app: { expireLapsedImpersonations },
    processStore,
  });
  const process = definition.processManagers.get(IMPERSONATION_EXPIRY_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no impersonation expiry process manager");
  return { processStore, process, expireLapsedImpersonations };
}

describe("given auth's impersonation expiry declaration", () => {
  describe("when the module is declared", () => {
    /** @scenario "An impersonation that runs out is audited and cleared" */
    it("carries the ten-minute sweep onto the installable module", () => {
      expect(authProcessModule.eventing?.pipeline).toContain(
        IMPERSONATION_MAINTENANCE_PIPELINE_NAME,
      );
      expect(IMPERSONATION_EXPIRY_INTERVAL_MS).toBe(10 * 60 * 1000);
    });
  });

  describe("when the schedule fires", () => {
    /** @scenario "An impersonation that runs out is audited and cleared" */
    it("runs the app's sweep and prunes its bookkeeping", async () => {
      const { processStore, process, expireLapsedImpersonations } = built();
      const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");

      await process.config.intents!.sweep!.run(
        { scheduledFor: 0 },
        {
          processName: IMPERSONATION_EXPIRY_PROCESS_NAME,
          projectId: "global",
          processKey: "global",
          tenantId: "global",
          messageKey: `${IMPERSONATION_EXPIRY_PROCESS_NAME}:0`,
          attempt: 1,
        },
      );

      expect(expireLapsedImpersonations).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
        processName: IMPERSONATION_EXPIRY_PROCESS_NAME,
      });
    });
  });
});
