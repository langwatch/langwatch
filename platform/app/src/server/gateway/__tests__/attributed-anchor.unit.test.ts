// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it, vi } from "vitest";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { GatewayScopeOrgMismatchError } from "~/server/gateway/errors";

function serviceWith(vkFound: boolean, projectFound: boolean) {
  const prisma = {
    virtualKey: {
      findFirst: vi.fn().mockResolvedValue(vkFound ? { id: "vk_1" } : null),
    },
    project: {
      findFirst: vi.fn().mockResolvedValue(projectFound ? { id: "proj_1" } : null),
    },
  } as never;
  // The ClickHouse repo's presence is what template creation requires;
  // validation throws before any spend read, so a bare object suffices.
  return GatewayBudgetService.create(prisma, {} as never);
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
