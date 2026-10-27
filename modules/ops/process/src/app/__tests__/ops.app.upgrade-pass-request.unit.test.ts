/** The pass a finished upgrade asks for carries a tenant the ClickHouse event store can route. */
import { PLATFORM_TENANT_ID } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { OpsSystemMigrationRunner } from "../ops.app.ts";
import { createOpsTestApp } from "./ops.fixture.ts";

describe("given an upgrade run that has finished", () => {
  describe("when it asks a worker for a system-migrations pass", () => {
    /** @scenario "The pass a finished upgrade requests is asked under the platform tenant" */
    it("sends the request under the platform tenant", async () => {
      const requesters: string[] = [];
      const { app } = createOpsTestApp({
        members: {
          createSystemMigrations: () =>
            createApiFixture<OpsSystemMigrationRunner>({
              startPass: async ({ actorUserId }) => {
                requesters.push(actorUserId);
              },
            }),
        },
      });

      await app.requestSystemMigrationPassAfterUpgrade();

      expect(requesters).toEqual([PLATFORM_TENANT_ID]);
    });
  });
});
