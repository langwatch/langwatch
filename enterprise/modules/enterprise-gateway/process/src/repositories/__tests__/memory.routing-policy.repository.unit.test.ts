// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { MemoryRoutingPolicyRepository } from "../memory/memory.routing-policy.repository.ts";

describe("the memory routing-policy repository", () => {
  describe("when a routing policy is made the organization default", () => {
    it("leaves exactly one default behind", async () => {
      const repository = MemoryRoutingPolicyRepository.create();
      const first = await repository.create({
        organizationId: "org-1",
        name: "first",
        modelProviderIds: ["provider-1"],
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        isDefault: true,
        actorUserId: "user-1",
      });
      const second = await repository.create({
        organizationId: "org-1",
        name: "second",
        modelProviderIds: ["provider-1"],
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        actorUserId: "user-1",
      });

      await repository.setDefault({
        id: second.id,
        organizationId: "org-1",
        actorUserId: "user-1",
      });

      await expect(
        repository.findDefaultForUser({ organizationId: "org-1" }),
      ).resolves.toMatchObject({ id: second.id });
      await expect(repository.findById(first.id)).resolves.toMatchObject({
        isDefault: false,
      });
    });
  });
});
