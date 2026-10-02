/**
 * @vitest-environment node
 * The grants family installed the way a process installs authz: both doors
 * mounted, the old one deprecated towards the new, and the new operations
 * answered by the composed app. @see specs/rbac/grants-rest-api.feature
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { authzProcessModule } from "../../authz.module.ts";
import { authzGrantRest } from "../../transport/authz-grant.rest.ts";
import { authzRoleBindingRest } from "../../transport/authz-role-binding.rest.ts";

function process() {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(authzProcessModule)])
    .withConfig({
      authz: {
        epochCacheEnabled: false,
        demoProjectId: undefined,
        demoProjectUserId: undefined,
        demoProjectSlug: undefined,
      },
    })
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withKeyvalue(redisDouble())
    .withEventing(
      new EventSourcing({ enabled: false, processStore: InMemoryProcessStore.createForTesting() }),
    )
    .provide({});
}

describe("given a process that installed authz", () => {
  it("mounts /api/grants beside /api/role-bindings, which names it as its successor", () => {
    expect(authzProcessModule.transports).toContain(authzGrantRest);
    expect(authzProcessModule.transports).toContain(authzRoleBindingRest);
    expect(authzGrantRest.router().deprecated).toBeUndefined();
    expect(authzRoleBindingRest.router().deprecated?.successor).toBe("/api/grants");
  });

  it("answers the grant operations through the composed app", async () => {
    const runtime = await process().boot();

    try {
      const authz = runtime.service(AuthzApi);

      await expect(
        authz.findPermissionsBeyondCaller({
          organizationId: "org-1",
          caller: { type: "apiKey", id: "key-1" },
          scope: { type: "organization", id: "org-1" },
          permissions: [],
        }),
      ).resolves.toEqual([]);
      for (const operation of [
        "listGrants",
        "getGrant",
        "createGrant",
        "changeGrantRole",
        "revokeGrant",
      ] as const) {
        expect(authz[operation]).toBeTypeOf("function");
      }
    } finally {
      await runtime.stop();
    }
  });
});
