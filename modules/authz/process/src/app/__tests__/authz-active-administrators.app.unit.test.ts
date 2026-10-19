/**
 * AuthzApi.findActiveOrganizationAdministrators answers organization's own definition of an
 * administrator who can sign in, through the composed app (specs/active-administrators.feature).
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { OrganizationRole } from "../../repositories/authz-read.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzReadRepository } from "../../repositories/memory/memory.authz-read.repository.ts";
import { MemoryAuthzRepositories } from "../../repositories/memory/memory.authz.repositories.ts";
import { AuthzModule, type AuthzSetup } from "../authz.app.ts";

const ORGANIZATION = "org_admins";

function composeOver(memory: AuthzMemoryStore) {
  return AuthzModule.create({
    dependencies: {},
    config: {
      epochCacheEnabled: false,
      demoProjectId: undefined,
      demoProjectUserId: undefined,
      demoProjectSlug: undefined,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<AuthzSetup["secrets"]>(),
    repositories: {
      ...MemoryAuthzRepositories.create(),
      read: MemoryAuthzReadRepository.create({ memory }),
    },
  });
}

function seat(
  memory: AuthzMemoryStore,
  input: { userId: string; role: OrganizationRole; disabled?: boolean },
) {
  memory.memberships.set(memory.membershipKey(ORGANIZATION, input.userId), {
    role: input.role,
    disabled: input.disabled ?? false,
    membershipStamp: `stamp_${input.userId}`,
    pendingSsoGrantId: null,
    createdAt: Temporal.Instant.fromEpochMilliseconds(0),
  });
}

describe("AuthzApi.findActiveOrganizationAdministrators", () => {
  describe("when an organization has administrators on enabled and disabled seats", () => {
    /** @scenario "A seat-disabled administrator is not counted" */
    it("names the administrators on enabled seats only, leaving members out", async () => {
      const memory = AuthzMemoryStore.create();
      seat(memory, { userId: "user_admin", role: "ADMIN" });
      seat(memory, { userId: "user_disabled_admin", role: "ADMIN", disabled: true });
      seat(memory, { userId: "user_member", role: "MEMBER" });
      const app = composeOver(memory);

      await expect(
        app.findActiveOrganizationAdministrators({ organizationId: ORGANIZATION }),
      ).resolves.toEqual(["user_admin"]);
    });
  });

  describe("when the organization is unknown", () => {
    /** @scenario "An unknown organisation has no active administrators" */
    it("answers an empty list", async () => {
      const app = composeOver(AuthzMemoryStore.create());

      await expect(
        app.findActiveOrganizationAdministrators({ organizationId: "org_unknown" }),
      ).resolves.toEqual([]);
    });
  });
});
