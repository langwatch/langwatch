/**
 * @vitest-environment node
 * The grants family installed the way a process installs authz: both doors
 * mounted, the old one deprecated towards the new, and the new operations
 * answered by the composed app. @see specs/rbac/grants-rest-api.feature
 */
import { AuthzApi } from "@langwatch/authz-contract";
import { EventSourcing, EventStoreProducerOnly, InMemoryProcessStore } from "@langwatch/eventing";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { authzProcessModule } from "../../authz.module.ts";
import { AUTHZ_GRANT_PIPELINE_NAME } from "../../eventing/authz-grant.pipeline.ts";
import { authzGrantRest } from "../../transport/authz-grant.rest.ts";
import { authzRoleBindingRest } from "../../transport/authz-role-binding.rest.ts";

const AUTHZ_CONFIG = {
  authz: {
    epochCacheEnabled: false,
    demoProjectId: undefined,
    demoProjectUserId: undefined,
    demoProjectSlug: undefined,
  },
};

function eventing() {
  return new EventSourcing({
    enabled: false,
    processStore: InMemoryProcessStore.createForTesting(),
  });
}

function process() {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(authzProcessModule)])
    .withConfig(AUTHZ_CONFIG)
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withEventing(eventing())
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

type UnsuppliedProcess = { provide(supply: object): { boot(): Promise<unknown> } };

describe("given a process with dispatch and no database", () => {
  /** @scenario A process with no database composes no AuthZ service */
  it("refuses the boot naming the database member it cannot supply", async () => {
    const withoutDatabase = createApp({ role: "api" })
      .withModules([withMemoryRepositories(authzProcessModule)])
      .withConfig(AUTHZ_CONFIG)
      .withEventing(eventing());
    // wrong-typed input: the builder refuses a missing member at compile time, boot at run time
    const booting = (withoutDatabase as unknown as UnsuppliedProcess).provide({}).boot();

    await expect(booting).rejects.toMatchObject({
      name: "MissingMemberError",
      module: "authz",
      member: "prisma",
    });
  });
});

async function ledgerOf(role: "api" | "worker") {
  const eventSourcing = new EventSourcing({
    enabled: true,
    eventStore: EventStoreProducerOnly.create({ processName: `langwatch-${role}` }),
    queueFactory: () => ({
      async send() {},
      async sendBatch() {},
      async waitUntilReady() {},
      async close() {},
    }),
    consumersEnabled: false,
    executionTarget: role,
  });
  const runtime = await createApp({ role })
    .withModules([withMemoryRepositories(authzProcessModule)])
    .withConfig(AUTHZ_CONFIG)
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withEventing(eventSourcing)
    .provide({})
    .boot();
  try {
    const pipeline = eventSourcing.getPipeline(AUTHZ_GRANT_PIPELINE_NAME);
    return { kind: pipeline.constructor.name, commands: Object.keys(pipeline.commands) };
  } finally {
    await runtime.stop();
  }
}

describe("given a background worker composing its own graph", () => {
  /** @scenario The worker mounts the grants ledger itself */
  it("mounts the ledger without an AuthZ capability, as the pipeline the api process registers", async () => {
    const worker = await ledgerOf("worker");
    const application = await ledgerOf("api");

    expect(worker.kind).not.toBe("DisabledPipeline");
    expect(worker.commands).toEqual([
      "attachGrant",
      "changeGrantRole",
      "revokeGrant",
      "defineRole",
      "changeRolePermissions",
      "deleteRole",
    ]);
    expect(worker).toEqual(application);
  });
});
