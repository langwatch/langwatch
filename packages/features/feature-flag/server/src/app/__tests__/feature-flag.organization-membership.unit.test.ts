/**
 * The per-organization answer covers only organizations the caller belongs to
 * and omits the rest, which would otherwise make it a membership oracle. The
 * whole list is resolved in ONE membership read, asserted on the call count
 * because a per-organization resolver would answer the same values.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagService } from "../../services/feature-flag.service.ts";
import { createFeatureFlagTestApp } from "./feature-flag.fixture.ts";

const USER_ID = "user_1";
const OWN_ORG_A = "org_own_a";
const OWN_ORG_B = "org_own_b";
const FOREIGN_ORG = "org_foreign";
const FLAG = "release_ui_ai_governance_enabled";

function buildApp(memberOf: Set<string>) {
  // One read for the whole list, so the count of calls is what pins the fix:
  // the fixture filters the requested ids itself rather than answering one at
  // a time.
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
  const app = createFeatureFlagTestApp({
    dependencies: {
      permissions: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => OWN_ORG_A }),
      organizations: createApiFixture<OrganizationApi>({ memberOrganizationIds }),
    },
  });

  return { app, memberOrganizationIds };
}

describe("featureFlag organization membership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "Legacy organization maps do not reveal membership" */
  it("evaluates every organization the caller belongs to", async () => {
    const { app } = buildApp(new Set([OWN_ORG_A, OWN_ORG_B]));
    const isEnabled = vi
      .spyOn(FeatureFlagService.prototype, "isEnabled")
      .mockImplementation(async (_flag, target) => {
        return target.kind === "organization" && target.organizationId === OWN_ORG_B;
      });

    await expect(
      app.isEnabledByOrganizationForCaller({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, OWN_ORG_B],
        userId: USER_ID,
      }),
    ).resolves.toEqual({ [OWN_ORG_A]: false, [OWN_ORG_B]: true });

    const organizationIds = isEnabled.mock.calls.flatMap(([, target]) => {
      return target.kind === "organization" ? [target.organizationId] : [];
    });
    expect(organizationIds.sort()).toEqual([OWN_ORG_A, OWN_ORG_B].sort());
  });

  /** @scenario "Legacy organization maps do not reveal membership" */
  it("silently drops organizations the caller does not belong to", async () => {
    const { app } = buildApp(new Set([OWN_ORG_A]));
    const isEnabled = vi.spyOn(FeatureFlagService.prototype, "isEnabled").mockResolvedValue(true);

    await expect(
      app.isEnabledByOrganizationForCaller({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, FOREIGN_ORG],
        userId: USER_ID,
      }),
    ).resolves.toEqual({ [OWN_ORG_A]: true });

    expect(isEnabled).toHaveBeenCalledOnce();
    expect(isEnabled.mock.calls[0]?.[1]).toEqual({
      kind: "organization",
      userId: USER_ID,
      organizationId: OWN_ORG_A,
    });
  });

  /** @scenario "Legacy organization maps do not reveal membership" */
  it("does not reveal whether an absent entry means no membership or flag off", async () => {
    const nonMember = buildApp(new Set());
    const member = buildApp(new Set([OWN_ORG_A]));
    vi.spyOn(FeatureFlagService.prototype, "isEnabled").mockResolvedValue(false);

    await expect(
      nonMember.app.isEnabledByOrganizationForCaller({
        flag: FLAG,
        organizationIds: [FOREIGN_ORG],
        userId: USER_ID,
      }),
    ).resolves.toEqual({});
    await expect(
      member.app.isEnabledByOrganizationForCaller({
        flag: FLAG,
        organizationIds: [OWN_ORG_A],
        userId: USER_ID,
      }),
    ).resolves.toEqual({ [OWN_ORG_A]: false });
  });

  describe("given a caller who belongs to many organizations", () => {
    describe("when the flag is asked for every one of them", () => {
      it("resolves every membership in a single read", async () => {
        const organizationIds = Array.from({ length: 65 }, (_, index) => `org_${index}`);
        const { app, memberOrganizationIds } = buildApp(new Set(organizationIds));
        vi.spyOn(FeatureFlagService.prototype, "isEnabled").mockResolvedValue(false);

        await app.isEnabledByOrganizationForCaller({
          flag: FLAG,
          organizationIds,
          userId: USER_ID,
        });

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
        const { app, memberOrganizationIds } = buildApp(new Set([OWN_ORG_A]));
        const isEnabled = vi.spyOn(FeatureFlagService.prototype, "isEnabled");

        await expect(
          app.isEnabledByOrganizationForCaller({
            flag: FLAG,
            organizationIds: [],
            userId: USER_ID,
          }),
        ).resolves.toEqual({});

        expect(memberOrganizationIds).not.toHaveBeenCalled();
        expect(isEnabled).not.toHaveBeenCalled();
      });
    });
  });
});
