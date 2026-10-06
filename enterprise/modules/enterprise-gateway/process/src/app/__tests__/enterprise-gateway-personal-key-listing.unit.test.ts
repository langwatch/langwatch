// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `personalVirtualKeys.list` through the booted module, asking the real authz engine over
 * collected grants, so each role template is read at the moment of the call.
 * @see specs/ai-gateway/governance/vk-scope-rbac.feature
 */
import { PermissionDeniedError } from "@langwatch/authorization";
import {
  AuthzEngine,
  type AuthzApi,
  type CollectedBinding,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { GatewayApi, GatewayVirtualKeyRecord } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { enterpriseGatewayProcessModule } from "../../enterprise-gateway.module.ts";

const ORG = "acme";
const LEO = "leo@acme.test";
const MAYA = "maya@acme.test";
const ADMIN = "admin@acme.test";

function personalKey({ id, principalUserId }: { id: string; principalUserId: string }) {
  const now = Temporal.Instant.fromEpochMilliseconds(0);
  return {
    id,
    organizationId: ORG,
    name: "default",
    description: "Personal virtual key",
    status: "ACTIVE",
    purpose: "USER",
    externalId: null,
    metadata: null,
    disabledAt: null,
    disabledReason: null,
    expiresAt: null,
    hashedSecret: "hashed",
    displayPrefix: "vk_abc",
    principalUserId,
    traceProjectId: null,
    config: null,
    revision: 1n,
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    revokedAt: null,
    revokedById: null,
    createdAt: now,
    updatedAt: now,
    createdById: principalUserId,
    lastUsedAt: null,
    routingPolicyId: null,
    routingMode: "NONE",
    scopes: [{ scopeType: "PROJECT", scopeId: `personal_${principalUserId}` }],
    principalUser: null,
    routingPolicy: null,
  } satisfies GatewayVirtualKeyRecord;
}

const STORED_KEYS = [
  personalKey({ id: "vk_leo", principalUserId: LEO }),
  personalKey({ id: "vk_maya", principalUserId: MAYA }),
];

function grantsOf({
  userId,
  organizationRole,
  bindings = [],
  customRolePermissions = new Map<string, readonly string[]>(),
}: {
  userId: string;
  organizationRole: CollectedGrants["organizationRole"];
  bindings?: CollectedBinding[];
  customRolePermissions?: Map<string, readonly string[]>;
}): CollectedGrants {
  return {
    principal: { type: "user", id: userId },
    organizationId: ORG,
    organizationRole,
    isOrgMember: true,
    membershipDisabled: false,
    bindings,
    customRolePermissions,
  };
}

async function listAs({
  actorUserId,
  grants,
  targetUserId,
}: {
  actorUserId: string;
  grants: CollectedGrants;
  targetUserId?: string;
}) {
  const engine = new AuthzEngine();
  const asked: string[] = [];
  const { logger } = createTestLogger();
  const runtime = await createApp({ role: "api" })
    .withModules([enterpriseGatewayProcessModule])
    .withStores(memoryStores())
    .withObservability((observability) => observability.withLogging(logger))
    .provide({
      gateway: createApiFixture<GatewayApi>({
        findPersonalVirtualKeys: async ({ principalUserId }) =>
          STORED_KEYS.filter(
            (key) => principalUserId === undefined || key.principalUserId === principalUserId,
          ),
      }),
      project: createApiFixture<ProjectApi>(),
      organization: createApiFixture<OrganizationApi>({ isMember: async () => true }),
      authz: createApiFixture<AuthzApi>({
        getDecision: async ({ permission, scope }) => {
          asked.push(permission);
          const decision = engine.decide({
            grants,
            permission,
            scope: { type: "organization", id: scope.id },
          });
          return { permitted: decision.allowed, organizationRole: grants.organizationRole };
        },
      }),
      "model-provider": createApiFixture<ModelProviderApi>(),
    })
    .boot();

  try {
    const listing = runtime.service(EnterpriseGatewayApi).listPersonalVirtualKeys({
      organizationId: ORG,
      actorUserId,
      ...(targetUserId === undefined ? {} : { targetUserId }),
    });
    const outcome = await listing.then(
      (keys) => ({ keys: keys.map((key) => key.id), refusal: undefined }),
      (refusal: unknown) => ({ keys: undefined, refusal }),
    );
    return { ...outcome, asked };
  } finally {
    await runtime.stop();
  }
}

describe("given personal virtual keys held by two members", () => {
  describe("when a member with no grant lists", () => {
    const leo = grantsOf({ userId: LEO, organizationRole: "MEMBER" });

    /** @scenario "A user can view their own personal VK without any explicit grant" */
    it("answers their own key and never asks for virtualKeys:view", async () => {
      const { keys, asked } = await listAs({ actorUserId: LEO, grants: leo });

      expect(keys).toEqual(["vk_leo"]);
      expect(asked).not.toContain("virtualKeys:view");
    });

    /** @scenario "A user can view their own personal VK without any explicit grant" */
    it("asks nothing at all when naming themselves", async () => {
      const { keys, asked } = await listAs({ actorUserId: LEO, grants: leo, targetUserId: LEO });

      expect(keys).toEqual(["vk_leo"]);
      expect(asked).toEqual([]);
    });
  });

  describe("when a member holding only virtualKeys:view names another member", () => {
    const maya = grantsOf({
      userId: MAYA,
      organizationRole: "MEMBER",
      bindings: [
        {
          roleKey: "custom:viewer-only",
          scopeType: "ORGANIZATION",
          scopeId: ORG,
          viaGroupId: null,
        },
      ],
      customRolePermissions: new Map([["viewer-only", ["virtualKeys:view"]]]),
    });

    /** @scenario "A user cannot view another user's personal VK without virtualKeys:viewOtherPersonal" */
    it("is refused 403 permission_denied naming virtualKeys:viewOtherPersonal", async () => {
      const { refusal, keys } = await listAs({
        actorUserId: MAYA,
        grants: maya,
        targetUserId: LEO,
      });

      expect(keys).toBeUndefined();
      expect(refusal).toBeInstanceOf(PermissionDeniedError);
      expect(refusal).toMatchObject({
        code: "permission_denied",
        httpStatus: 403,
        meta: { permission: "virtualKeys:viewOtherPersonal" },
      });
    });
  });

  describe("when an organization admin lists", () => {
    const adminBinding: CollectedBinding = {
      roleKey: "admin",
      scopeType: "ORGANIZATION",
      scopeId: ORG,
      viaGroupId: null,
    };
    const admin = grantsOf({
      userId: ADMIN,
      organizationRole: "ADMIN",
      bindings: [adminBinding],
    });

    /** @scenario "Org admin with viewOtherPersonal can audit other users' personal VKs (offboarding sweep)" */
    it("sees every member's personal keys when naming no one", async () => {
      const { keys, asked } = await listAs({ actorUserId: ADMIN, grants: admin });

      expect(keys).toEqual(["vk_leo", "vk_maya"]);
      expect(asked).toEqual(["virtualKeys:viewOtherPersonal"]);
    });

    /** @scenario "Existing org admins automatically gain virtualKeys:viewOtherPersonal on migrate" */
    it("lists another member's keys from a binding that carries no permission list", async () => {
      const before = structuredClone(admin.bindings);

      const { keys } = await listAs({ actorUserId: ADMIN, grants: admin, targetUserId: LEO });

      expect(keys).toEqual(["vk_leo"]);
      expect(admin.customRolePermissions.size).toBe(0);
      expect(admin.bindings).toEqual(before);
    });
  });

  describe("when an organization member lists another member's keys", () => {
    const member = grantsOf({
      userId: MAYA,
      organizationRole: "MEMBER",
      bindings: [{ roleKey: "member", scopeType: "ORGANIZATION", scopeId: ORG, viaGroupId: null }],
    });

    /** @scenario "Org member roles do NOT gain virtualKeys:viewOtherPersonal" */
    it("is still refused 403 permission_denied", async () => {
      const { refusal, keys } = await listAs({
        actorUserId: MAYA,
        grants: member,
        targetUserId: LEO,
      });

      expect(keys).toBeUndefined();
      expect(refusal).toMatchObject({
        code: "permission_denied",
        httpStatus: 403,
        meta: { permission: "virtualKeys:viewOtherPersonal" },
      });
    });
  });
});
