/** Spec: specs/migration/system-migrations-runner.feature */
import { SCHEDULED_SINGLETON_PROJECT_ID } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import type { MigrationPassSummary } from "@langwatch/system-migrations";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER,
  systemMigrationPassRequested,
} from "../../../../eventing/ops-system-migrations.process.ts";
import type { SystemMigrationsServiceDependencies } from "../../../../rules/system-migration-support.rules.ts";
import { SystemMigrationsService } from "../system-migrations.service.ts";

const QUIET: MigrationPassSummary = {
  tenantsSeen: 3,
  finalized: 0,
  held: 0,
  parked: 0,
  skipped: 0,
  alreadyFinalized: 0,
  alreadyRolledBack: 0,
  claimed: 0,
  advanced: 0,
};

function serviceWith(passes: MigrationPassSummary[]) {
  const runPass = vi.fn<SystemMigrationsServiceDependencies["runPass"]>();
  for (const pass of passes) runPass.mockResolvedValueOnce(pass);
  runPass.mockResolvedValue(QUIET);
  const requestPass = vi.fn<SystemMigrationsServiceDependencies["requestPass"]>(async () => {});
  const service = SystemMigrationsService.create(
    createApiFixture<SystemMigrationsServiceDependencies>(
      { runPass, requestPass, hasTenantAwaitingRedrive: vi.fn(async () => true) },
      "system migration deps",
    ),
  );
  return { service, runPass, requestPass };
}

async function run(promise: Promise<void>): Promise<void> {
  await vi.runAllTimersAsync();
  await promise;
}

describe("SystemMigrationsService.executePass", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("when a pass advances an organization", () => {
    /** @scenario "A worker's pass keeps running while a pass still advances something" */
    it("runs passes until one advances nothing", async () => {
      const { service, runPass } = serviceWith([
        { ...QUIET, advanced: 2 },
        { ...QUIET, advanced: 1 },
      ]);

      await run(service.executePass({ redrive: false }));

      expect(runPass).toHaveBeenCalledTimes(3);
    });
  });

  describe("when the run newly holds a tenant", () => {
    /** @scenario "A run that newly holds a tenant asks for one follow-up pass a minute later" */
    it("requests one follow-up pass sixty seconds later", async () => {
      const { service, requestPass } = serviceWith([
        { ...QUIET, advanced: 2, held: 2 },
        { ...QUIET, held: 2 },
      ]);

      await run(service.executePass({ redrive: false }));

      expect(requestPass).toHaveBeenCalledOnce();
      expect(requestPass).toHaveBeenCalledWith({
        actorUserId: SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER,
        delayMs: 60_000,
      });
    });

    /** @scenario "A run that newly holds a tenant asks for one follow-up pass a minute later" */
    it("asks under the scheduled singleton's tenant, which the event store can place", () => {
      expect(SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER).toBe(SCHEDULED_SINGLETON_PROJECT_ID);
    });

    /** @scenario "A run that newly holds a tenant asks for one follow-up pass a minute later" */
    it("marks the pass that request asks for as the follow-up", () => {
      const asked = systemMigrationPassRequested(
        { lastRequestedAt: null },
        {},
        {
          at: 1,
          now: 1,
          key: "system_migration_pass_requests",
          projectId: SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER,
          intent: intentAccessorOf({
            runPass: (messageKey, payload) => ({ messageKey, intentType: "runPass", payload }),
          }),
        },
      );

      expect(asked.intents).toEqual([
        expect.objectContaining({ payload: expect.objectContaining({ followUp: true }) }),
      ]);
    });
  });

  describe("when tenants stay held", () => {
    /** @scenario "Tenants that stay held never loop the follow-up pass" */
    it("asks for nothing more from the follow-up pass itself", async () => {
      const { service, requestPass } = serviceWith([
        { ...QUIET, advanced: 1, held: 2 },
        { ...QUIET, held: 2 },
      ]);

      await run(service.executePass({ redrive: false, followUp: true }));

      expect(requestPass).not.toHaveBeenCalled();
    });

    /** @scenario "Tenants that stay held never loop the follow-up pass" */
    it("asks for no follow-up when the run advanced nothing", async () => {
      const { service, requestPass } = serviceWith([{ ...QUIET, held: 2 }]);

      await run(service.executePass({ redrive: true }));

      expect(requestPass).not.toHaveBeenCalled();
    });
  });
});
