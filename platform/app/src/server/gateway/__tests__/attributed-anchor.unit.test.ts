// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import { PrismaGatewayAdapter } from "@langwatch/gateway-server";
import { GatewayScopeOrgMismatchError } from "@langwatch/gateway-server";

/**
 * The process's own composition, over the fake database.
 *
 * `GatewayService` no longer takes a `PrismaClient`: the anchor guards run
 * inside `PrismaGatewayBudgetRepository.create`, and the project anchor is
 * proved through the `ProjectService` the service is built with. Building the
 * pair the way `PrismaGatewayAdapter` builds it is what keeps both halves of
 * the validation under test rather than only the half that stayed put.
 */
function serviceWith(vkFound: boolean, projectFound: boolean) {
  const prisma = {
    virtualKey: {
      findFirst: vi.fn().mockResolvedValue(vkFound ? { id: "vk_1", purpose: "USER" } : null),
    },
    project: {
      findFirst: vi.fn().mockResolvedValue(projectFound ? { id: "proj_1" } : null),
    },
  } as never;
  const projects = {
    tryGetWithTeam: vi
      .fn()
      .mockResolvedValue(
        projectFound ? { id: "proj_1", teamId: "team_1", team: { organizationId: "org_1" } } : null,
      ),
  } as never;
  return PrismaGatewayAdapter.create({
    database: prisma,
    projects,
    evaluators: {} as never,
    monitors: {} as never,
    changes: {} as never,
    audit: {} as never,
    // The ClickHouse repo's presence is what template creation requires;
    // validation throws before any spend read, so a bare object suffices.
    budgetSpend: {} as never,
  }).build();
}

const base = {
  organizationId: "org_1",
  name: "per user cap",
  window: "MONTH" as const,
  limitUsd: 100,
  actorUserId: "user_admin",
};

describe("attributed-user anchor validation", () => {
  /** @scenario Templates anchor on virtual keys and projects only */
  it("requires exactly one in-org anchor", async () => {
    await expect(
      serviceWith(false, false).create({
        ...base,
        scope: { kind: "ATTRIBUTED_USER" },
      }),
    ).rejects.toBeInstanceOf(GatewayScopeOrgMismatchError);

    await expect(
      serviceWith(true, true).create({
        ...base,
        scope: {
          kind: "ATTRIBUTED_USER",
          anchorVirtualKeyId: "vk_1",
          anchorProjectId: "proj_1",
        },
      }),
    ).rejects.toBeInstanceOf(GatewayScopeOrgMismatchError);

    await expect(
      serviceWith(false, false).create({
        ...base,
        scope: { kind: "ATTRIBUTED_USER", anchorVirtualKeyId: "vk_other_org" },
      }),
    ).rejects.toBeInstanceOf(GatewayScopeOrgMismatchError);
  });
});
