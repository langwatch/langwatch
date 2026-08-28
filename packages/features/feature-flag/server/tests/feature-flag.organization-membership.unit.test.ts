/**
 * The legacy per-organization procedures answer only for organizations the
 * caller belongs to, and omit the rest rather than reporting them as false:
 * a present-and-false entry would make the endpoint a membership oracle.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import { TrpcRootDefinition } from "@langwatch/api/trpc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FeatureFlagTrpcApi,
  type FeatureFlagTrpcContext,
} from "../src/api/app-trpc/feature-flag.api";
import { MemoryFeatureFlagService } from "../src/testing";

const USER_ID = "user_1";
const OWN_ORG_A = "org_own_a";
const OWN_ORG_B = "org_own_b";
const FOREIGN_ORG = "org_foreign";
const FLAG = "release_ui_ai_governance_enabled";

const trpc = TrpcRootDefinition.forContext<FeatureFlagTrpcContext>().create({});
const featureFlagRouter = FeatureFlagTrpcApi.create(trpc);

type PermissionCheck = {
  userId: string;
  permission: string;
  projectId?: string;
  organizationId?: string;
};

function buildCaller(memberOf: Set<string>) {
  const featureFlags = MemoryFeatureFlagService.create();
  const hasPermission = vi.fn(async (_check: PermissionCheck): Promise<boolean> => true);
  const getOrganizationId = vi.fn(async (_projectId: string): Promise<string> => OWN_ORG_A);
  const isMember = vi.fn(
    async ({
      organizationId,
      userId,
    }: {
      organizationId: string;
      userId: string;
    }): Promise<boolean> => userId === USER_ID && memberOf.has(organizationId),
  );
  const permissions: Pick<AuthzService, "hasPermission"> = { hasPermission };
  const context: FeatureFlagTrpcContext = {
    app: {
      featureFlags,
      permissions,
      projects: { getOrganizationId },
      organizations: { isMember },
    },
    actor: () => ({ id: USER_ID }),
  };

  return {
    caller: featureFlagRouter.createCaller(context),
    featureFlags,
    isMember,
  };
}

describe("featureFlag organization membership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** @scenario "Legacy organization maps do not reveal membership" */
  it("evaluates every organization the caller belongs to", async () => {
    const { caller, featureFlags } = buildCaller(new Set([OWN_ORG_A, OWN_ORG_B]));
    const isEnabled = vi
      .spyOn(featureFlags, "isEnabled")
      .mockImplementation(async (_flag, target) => {
        return target.kind === "organization" && target.organizationId === OWN_ORG_B;
      });

    await expect(
      caller.isEnabledForAnyOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, OWN_ORG_B],
      }),
    ).resolves.toEqual({ enabled: true });

    const organizationIds = isEnabled.mock.calls.flatMap(([, target]) => {
      return target.kind === "organization" ? [target.organizationId] : [];
    });
    expect(organizationIds.sort()).toEqual([OWN_ORG_A, OWN_ORG_B].sort());
  });

  /** @scenario "Legacy organization maps do not reveal membership" */
  it("silently drops organizations the caller does not belong to", async () => {
    const { caller, featureFlags } = buildCaller(new Set([OWN_ORG_A]));
    const isEnabled = vi.spyOn(featureFlags, "isEnabled").mockResolvedValue(true);

    await expect(
      caller.isEnabledForAnyOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, FOREIGN_ORG],
      }),
    ).resolves.toEqual({ enabled: true });

    expect(isEnabled).toHaveBeenCalledOnce();
    expect(isEnabled.mock.calls[0]?.[1]).toEqual({
      kind: "organization",
      userId: USER_ID,
      organizationId: OWN_ORG_A,
    });
  });

  /** @scenario "Legacy organization maps do not reveal membership" */
  it("preserves the per-organization response and omits foreign organizations", async () => {
    const { caller, featureFlags } = buildCaller(new Set([OWN_ORG_A, OWN_ORG_B]));
    vi.spyOn(featureFlags, "isEnabled").mockImplementation(async (_flag, target) => {
      return target.kind === "organization" && target.organizationId === OWN_ORG_B;
    });

    await expect(
      caller.isEnabledForEachOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, FOREIGN_ORG, OWN_ORG_B],
      }),
    ).resolves.toEqual({
      enabledByOrganizationId: {
        [OWN_ORG_A]: false,
        [OWN_ORG_B]: true,
      },
    });
  });

  it("does not reveal whether an absent result means no membership or flag off", async () => {
    const nonMember = buildCaller(new Set());
    const member = buildCaller(new Set([OWN_ORG_A]));

    const nonMemberResult = await nonMember.caller.isEnabledForAnyOrganization({
      flag: FLAG,
      organizationIds: [FOREIGN_ORG],
    });
    const memberResult = await member.caller.isEnabledForAnyOrganization({
      flag: FLAG,
      organizationIds: [OWN_ORG_A],
    });

    expect(nonMemberResult).toEqual({ enabled: false });
    expect(memberResult).toEqual(nonMemberResult);
  });

  it("does no membership or flag work for an empty list", async () => {
    const { caller, featureFlags, isMember } = buildCaller(new Set([OWN_ORG_A]));
    const isEnabled = vi.spyOn(featureFlags, "isEnabled");

    await expect(
      caller.isEnabledForAnyOrganization({ flag: FLAG, organizationIds: [] }),
    ).resolves.toEqual({ enabled: false });

    expect(isMember).not.toHaveBeenCalled();
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
