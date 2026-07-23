/**
 * @vitest-environment node
 *
 * A key outlives the access that justified it.
 *
 * Langy mints a per-chat key from the intersection of its candidate permissions
 * with what the caller holds, then that key lives in a worker's environment for
 * hours. The grant recorded at mint time is a SNAPSHOT, so the only thing that
 * makes a reduction take effect is the ceiling re-resolving the OWNING USER's
 * current bindings on every request. These pin that.
 *
 * @see specs/langy/langy-api-key-provisioning.feature
 *      "Reducing someone's access takes effect on keys already issued"
 */
import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { resolveApiKeyPermission, type ScopeRef } from "../role-binding-resolver";

const ORG = "org_1";
const TEAM = "team_1";
const PROJECT = "project_1";
const USER = "user_1";
const API_KEY = "apikey_1";
const KEY_ROLE = "customrole_key";
const USER_ROLE = "customrole_user";

const scope: ScopeRef = { type: "project", id: PROJECT, teamId: TEAM };

const customBinding = (customRoleId: string) => ({
  role: TeamUserRole.CUSTOM,
  customRoleId,
  scopeType: RoleBindingScopeType.PROJECT,
  scopeId: PROJECT,
});

/**
 * The key was minted while the user could manage scenarios, so its own custom
 * role still says so. `userPermissions` is what the user holds NOW.
 */
function makePrisma({
  userPermissions,
  userHasBinding = true,
}: {
  userPermissions: string[];
  /** False models access revoked outright — the binding itself is gone. */
  userHasBinding?: boolean;
}) {
  return {
    roleBinding: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where.apiKeyId) return [customBinding(KEY_ROLE)];
        if (where.group) return [];
        return userHasBinding ? [customBinding(USER_ROLE)] : [];
      }),
    },
    customRole: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => ({
        permissions:
          where.id === KEY_ROLE
            ? ["scenarios:view", "scenarios:manage"]
            : userPermissions,
      })),
    },
  } as never;
}

const allows = (
  userPermissions: string[],
  permission: string,
  options: { userHasBinding?: boolean } = {},
) =>
  resolveApiKeyPermission({
    prisma: makePrisma({ userPermissions, ...options }),
    apiKeyId: API_KEY,
    userId: USER,
    organizationId: ORG,
    scope,
    permission: permission as never,
  });

describe("resolveApiKeyPermission, given a key minted before an access change", () => {
  describe("when the user still holds the access the key was minted with", () => {
    it("allows the write", async () => {
      await expect(
        allows(["scenarios:view", "scenarios:manage"], "scenarios:manage"),
      ).resolves.toBe(true);
    });
  });

  describe("when the user's access has since been reduced", () => {
    it("refuses the write the key was minted for", async () => {
      await expect(allows(["scenarios:view"], "scenarios:manage")).resolves.toBe(
        false,
      );
    });

    it("still allows what the user can still do", async () => {
      await expect(allows(["scenarios:view"], "scenarios:view")).resolves.toBe(
        true,
      );
    });
  });

  describe("when the user has been removed from the project entirely", () => {
    it("refuses everything the key names", async () => {
      await expect(
        allows([], "scenarios:view", { userHasBinding: false }),
      ).resolves.toBe(false);
    });
  });
});
