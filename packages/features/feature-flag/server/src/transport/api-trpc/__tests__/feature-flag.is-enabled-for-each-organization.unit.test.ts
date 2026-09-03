/**
 * The variant every client surface actually calls (the workspace switcher and
 * the product shell), pinned on the property its siblings cannot show: the
 * whole membership list is resolved in ONE read, not one read per
 * organization. A resolver that asked per organization would return exactly
 * the same answers, so the assertions are on the call count.
 *
 * Both organization procedures share the one resolver, so the membership
 * filtering itself is asserted next door in
 * `feature-flag.organization-membership.unit.test.ts`.
 */
import { TrpcRootDefinition } from "@langwatch/api/trpc";
import type { AuthzService } from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryFeatureFlagService } from "../../../testing";
import { FeatureFlagTrpcApi, type FeatureFlagTrpcContext } from "../feature-flag.api";

const USER_ID = "user_1";
const OWN_ORG_A = "org_own_a";
const FLAG = "release_ui_ai_governance_enabled";

const trpc = TrpcRootDefinition.forContext<FeatureFlagTrpcContext>().create({});
const featureFlagRouter = FeatureFlagTrpcApi.create(trpc);

function buildCaller(memberOf: Set<string>) {
  const featureFlags = MemoryFeatureFlagService.create();
  const hasPermission = vi.fn(async (): Promise<boolean> => true);
  const getOrganizationId = vi.fn(async (): Promise<string> => OWN_ORG_A);
  const memberOrganizationIds = vi.fn(
    async ({
      userId,
      organizationIds,
    }: {
      userId: string;
      organizationIds: string[];
    }): Promise<string[]> =>
      userId === USER_ID
        ? organizationIds.filter((organizationId) => memberOf.has(organizationId))
        : [],
  );
  const permissions: Pick<AuthzService, "hasPermission"> = { hasPermission };
  const context: FeatureFlagTrpcContext = {
    app: {
      featureFlags,
      permissions,
      projects: { getOrganizationId },
      organizations: { memberOrganizationIds },
    },
    actor: () => ({ id: USER_ID }),
  };

  return {
    caller: featureFlagRouter.createCaller(context),
    featureFlags,
    memberOrganizationIds,
  };
}

describe("featureFlag.isEnabledForEachOrganization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a caller who belongs to many organizations", () => {
    describe("when the flag is asked for every one of them", () => {
      it("resolves every membership in a single read", async () => {
        const organizationIds = Array.from({ length: 65 }, (_, index) => `org_${index}`);
        const { caller, memberOrganizationIds } = buildCaller(new Set(organizationIds));

        await caller.isEnabledForEachOrganization({ flag: FLAG, organizationIds });

        expect(memberOrganizationIds).toHaveBeenCalledOnce();
        expect(memberOrganizationIds).toHaveBeenCalledWith({
          userId: USER_ID,
          organizationIds,
        });
      });
    });
  });

  describe("given an empty list of organizations", () => {
    describe("when the flag is asked for it", () => {
      it("answers an empty map without reading memberships or the flag", async () => {
        const { caller, featureFlags, memberOrganizationIds } = buildCaller(new Set([OWN_ORG_A]));
        const isEnabled = vi.spyOn(featureFlags, "isEnabled");

        await expect(
          caller.isEnabledForEachOrganization({ flag: FLAG, organizationIds: [] }),
        ).resolves.toEqual({ enabledByOrganizationId: {} });

        expect(memberOrganizationIds).not.toHaveBeenCalled();
        expect(isEnabled).not.toHaveBeenCalled();
      });
    });
  });
});
