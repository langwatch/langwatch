/** Spec: specs/identity/org-account-lockout.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { authServer } from "../../auth.server.ts";
import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import {
  SIGN_IN_LOCK_MAINTENANCE_PIPELINE_NAME,
  authEventing,
  buildSignInLockMaintenance,
} from "../auth.pipeline.ts";
import { SIGN_IN_LOCK_REAP_PROCESS_NAME } from "../sign-in-lock-reap.intent.ts";
import { SIGN_IN_LOCK_REAP_INTERVAL_MS } from "../sign-in-lock-reap.process.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function built() {
  const repositories = MemoryAuthRepositories.create();
  const processStore = InMemoryProcessStore.createForTesting();
  const definition = buildSignInLockMaintenance({
    participation: "consume",
    repositories,
    app: undefined,
    processStore,
  });
  const process = definition.processManagers.get(SIGN_IN_LOCK_REAP_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no sign-in lock reap process manager");
  return { repositories, processStore, definition, process };
}

describe("given auth's eventing declaration", () => {
  describe("when the module is declared", () => {
    /** @scenario "Finished lock-out rows are cleared a day after they settle" */
    it("carries the hourly reap onto the installable module", () => {
      expect(authServer.eventing).toBe(authEventing);
      expect(authEventing.pipeline).toBe(SIGN_IN_LOCK_MAINTENANCE_PIPELINE_NAME);
      expect(SIGN_IN_LOCK_REAP_INTERVAL_MS).toBe(HOUR_MS);
    });
  });

  describe("when the schedule fires", () => {
    /** @scenario "Finished lock-out rows are cleared a day after they settle" */
    it("removes the rows settled more than a day ago and prunes its bookkeeping", async () => {
      const { repositories, processStore, definition, process } = built();
      const deleteSettled = vi.spyOn(repositories.signInLocks, "deleteSettled");
      const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");
      const before = nowInstant().epochMilliseconds;

      await process.config.intents!.reap!.run(
        { scheduledFor: 0 },
        {
          processName: SIGN_IN_LOCK_REAP_PROCESS_NAME,
          projectId: "global",
          processKey: "global",
          tenantId: "global",
          messageKey: `${SIGN_IN_LOCK_REAP_PROCESS_NAME}:0`,
          attempt: 1,
        },
      );

      expect(definition.metadata.name).toBe(SIGN_IN_LOCK_MAINTENANCE_PIPELINE_NAME);
      expect(deleteSettled).toHaveBeenCalledTimes(1);
      const settledBefore = deleteSettled.mock.calls[0]![0].settledBefore.epochMilliseconds;
      expect(settledBefore).toBeGreaterThanOrEqual(before - DAY_MS);
      expect(settledBefore).toBeLessThanOrEqual(nowInstant().epochMilliseconds - DAY_MS);
      expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
        processName: SIGN_IN_LOCK_REAP_PROCESS_NAME,
      });
    });
  });
});
