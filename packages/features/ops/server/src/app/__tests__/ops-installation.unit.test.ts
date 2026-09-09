/**
 * @vitest-environment node
 * The feature installs: a process booting it over memory gets a working
 * `OpsApi`, the instance the runtime hands back, in either role.
 */
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { OpsApi } from "@langwatch/ops-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { opsServer } from "../../ops.server.ts";
import { createOpsTestInfrastructure, OPS_STAFF_ADDRESS } from "./ops.fixture.ts";

function process() {
  return createApp({ name: "ops-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure(createOpsTestInfrastructure())
    .withProvided(UserApi, createApiFixture<UserApi>())
    .withProvided(AuthApi, createApiFixture<AuthApi>())
    .withProvided(ProjectApi, createApiFixture<ProjectApi>({ searchByQuery: async () => [] }))
    .withProvided(AuditLogApi, createApiFixture<AuditLogApi>({ record: async () => {} }))
    .withProvided(ApiKeyApi, createApiFixture<ApiKeyApi>({ findResolvedToken: async () => null }))
    .withFeature(opsServer);
}

describe("ops app installation", () => {
  describe("given a process that boots the feature over memory", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process().boot({ role });

      try {
        const app = runtime.service(OpsApi);

        expect(runtime.feature(opsServer).provided).toBe(app);
        expect(app.operatorScope({ id: "user_alex", email: OPS_STAFF_ADDRESS })).toEqual({
          kind: "platform",
        });
        expect(app.operatorScope({ id: "user_sam", email: "sam@acme.com" })).toEqual({
          kind: "none",
        });

        const filed = await app.submitBugReport({
          report: {
            source: "cli",
            kind: "summary",
            title: "The CLI could not reach the API",
            summary: "It refused the key I had just minted.",
          },
        });

        await expect(
          app.getBugReport({ id: filed.id, actorUserId: "user_alex" }),
        ).resolves.toMatchObject({ title: "The CLI could not reach the API" });
      } finally {
        await runtime.stop();
      }
    });
  });
});
