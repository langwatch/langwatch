// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `routingPolicy.personalContext`, main's `user.personalContext`, served by the module that owns the policies.
 */
import { personalContextSchema, type RoutingPolicy } from "@langwatch/enterprise-gateway-contract";
import type { EnsuredPersonalWorkspace, OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { PersonalContextService } from "../personal-context.service.ts";

const WORKSPACE: EnsuredPersonalWorkspace = {
  kind: "ready",
  workspace: {
    team: { id: "team-1", name: "Ada's workspace", slug: "ada", createdAtMs: 0 },
    project: { id: "project-1", name: "Ada", slug: "ada", apiKey: "sk-lw-secret", createdAtMs: 0 },
  },
};

function routingPolicy({ id, name }: { id: string; name: string }): RoutingPolicy {
  return {
    id,
    organizationId: "org-1",
    name,
    description: null,
    modelProviderIds: [],
    modelAliases: {},
    defaultModel: null,
    policyRules: {},
    isDefault: true,
    createdAtMs: 0,
    updatedAtMs: 0,
    createdById: null,
    updatedById: null,
    scopes: [],
  };
}

function serviceWhere({
  member = true,
  defaults = [],
}: { member?: boolean; defaults?: RoutingPolicy[] } = {}) {
  const ensured: unknown[] = [];
  const asked: unknown[] = [];
  const service = PersonalContextService.create({
    members: createApiFixture<OrganizationApi>({
      isMember: async () => member,
      ensurePersonalWorkspace: async (input) => {
        ensured.push(input);
        return WORKSPACE;
      },
    }),
    users: createApiFixture<UserApi>({
      findById: async ({ id }) => ({
        id,
        name: "Ada",
        email: "ada@acme.test",
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastLoginAt: null,
        deactivatedAt: null,
      }),
    }),
    policies: {
      findDefaults: async (input) => {
        asked.push(input);
        return defaults;
      },
    },
  });
  return { service, ensured, asked };
}

describe("PersonalContextService.get", () => {
  /** @scenario "The personal context never carries the personal project's API key" */
  /** @scenario "Personal context remains usable when its base key is withheld" */
  it("blanks the API key and still answers a valid personal context", async () => {
    const { service, ensured } = serviceWhere();

    const context = await service.get({ userId: "user-1", organizationId: "org-1" });

    expect(context.workspace.project.apiKey).toBe("");
    expect(context.workspace.project.id).toBe("project-1");
    expect(personalContextSchema.parse(context).workspace.project.apiKey).toBe("");
    expect(ensured).toEqual([
      {
        userId: "user-1",
        organizationId: "org-1",
        displayName: "Ada",
        displayEmail: "ada@acme.test",
      },
    ]);
  });

  /** @scenario "The personal context names the default routing policy the enterprise gateway resolves" */
  it("names the most specific default routing policy for the personal team", async () => {
    const { service, asked } = serviceWhere({
      defaults: [
        routingPolicy({ id: "policy-team", name: "Team default" }),
        routingPolicy({ id: "policy-org", name: "Org default" }),
      ],
    });

    const context = await service.get({ userId: "user-1", organizationId: "org-1" });

    expect(context.routingPolicy).toEqual({ id: "policy-team", name: "Team default" });
    expect(asked).toEqual([{ organizationId: "org-1", personalTeamId: "team-1" }]);
  });

  /** @scenario "A caller outside the organization is refused their personal context" */
  it("refuses a non-member with user_not_in_organization before provisioning anything", async () => {
    const { service, ensured } = serviceWhere({ member: false });

    await expect(service.get({ userId: "user-1", organizationId: "org-1" })).rejects.toMatchObject({
      code: "user_not_in_organization",
    });
    expect(ensured).toEqual([]);
  });
});
