// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryGatewayStore } from "../repositories/memory/memory.gateway.store.ts";
import {
  memoryProjectWithTeam,
  memoryVirtualKeySeed,
} from "./support/gateway-memory-seeds.fixture.ts";
import { memoryGatewayService } from "./support/memory.gateway-service.ts";

/**
 * The process's own composition over the memory registry: the project anchor is proved through
 * the `ProjectApi` the service is built with, the key anchor inside the budget repository.
 */
async function serviceOver() {
  const { service, repositories } = memoryGatewayService({
    store: MemoryGatewayStore.create(),
    projects: createApiFixture<ProjectApi>({
      findWithTeam: async (id) =>
        id === "proj_1"
          ? memoryProjectWithTeam({ projectId: id, teamId: "team_1", organizationId: "org_1" })
          : null,
    }),
  });
  await repositories.virtualKeys.create(
    memoryVirtualKeySeed({ id: "vk_1", name: "in-org", organizationId: "org_1" }),
  );
  await repositories.virtualKeys.create(
    memoryVirtualKeySeed({ id: "vk_other_org", name: "elsewhere", organizationId: "org_other" }),
  );
  return service;
}

const base = {
  organizationId: "org_1",
  name: "per user cap",
  window: "MONTH" as const,
  limitUsd: 100,
  actorUserId: "user_admin",
};

const mismatch = { code: "gateway_scope_org_mismatch" };

describe("attributed-user anchor validation", () => {
  /** @scenario Templates anchor on virtual keys and projects only */
  it("requires exactly one in-org anchor", async () => {
    const sut = await serviceOver();

    await expect(
      sut.create({
        ...base,
        scope: { kind: "ATTRIBUTED_USER" },
      }),
    ).rejects.toMatchObject(mismatch);

    await expect(
      sut.create({
        ...base,
        scope: {
          kind: "ATTRIBUTED_USER",
          anchorVirtualKeyId: "vk_1",
          anchorProjectId: "proj_1",
        },
      }),
    ).rejects.toMatchObject(mismatch);

    await expect(
      sut.create({
        ...base,
        scope: { kind: "ATTRIBUTED_USER", anchorVirtualKeyId: "vk_other_org" },
      }),
    ).rejects.toMatchObject(mismatch);
  });
});
