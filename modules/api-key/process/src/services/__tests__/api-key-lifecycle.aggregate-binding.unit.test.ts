/**
 * An aggregate project owns no credential (ADR-175 decision 7), so no key may be bound to it,
 * whichever surface mints or edits the key. Refused with the code the ingest doors answer.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";
import type { ApiKeyGrantId } from "../api-key.service.ts";

const ORG_ID = "organization-1";
const ADMIN_ID = "admin-1";
const AGGREGATE_ID = "aggregate-1";
const EPOCH = new Date("2026-01-01T00:00:00Z");

const aggregate: ProjectWithTeam = {
  id: AGGREGATE_ID,
  name: "Company view",
  slug: "company-view",
  apiKey: "",
  lwqlKey: "",
  teamId: "team-1",
  language: "other",
  framework: "other",
  kind: "aggregate",
  firstMessage: false,
  integrated: false,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: false,
  ownerUserId: null,
  personalFeatures: null,
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
  team: {
    id: "team-1",
    name: "Team",
    slug: "team",
    organizationId: ORG_ID,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    archivedAt: null,
    isPersonal: false,
    ownerUserId: null,
    departmentId: null,
  },
};

function harness() {
  const repository = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const attachBindings = vi.fn<AuthzApi["attachBindings"]>(async () => ({
    attached: [],
    duplicates: [],
  }));
  // Everything past the scope check answers yes, so only the aggregate rule can refuse.
  const authz = createApiFixture<AuthzApi>({
    hasPermission: async () => true,
    listApiKeyBindings: async () => [],
    findPermissionsBeyondCaller: async () => [],
    revokeBindingsWhere: async () => 0,
    attachBindings,
  });
  const dependencies = {
    authz,
    grants: authz,
    organizations: createApiFixture<OrganizationApi>(),
    projects: createApiFixture<ProjectApi>({
      getWithTeam: async () => aggregate,
      findPersonalWorkspaceOwner: async () => null,
    }),
    bindingIds: createApiFixture<ApiKeyGrantId>({ generateBindingId: () => "binding-1" }),
    legacyGrants: { mint: () => void 0 },
    tokens: ApiKeyTokenService.create("test-pepper"),
  };
  const lifecycle = ApiKeyLifecycleService.create(
    { ...dependencies, repository },
    ApiKeyGrantPolicyService.create(dependencies),
    { forget: async () => void 0 },
  );

  return { lifecycle, repository, attachBindings };
}

const AGGREGATE_BINDING = {
  role: "MEMBER",
  scopeType: "PROJECT",
  scopeId: AGGREGATE_ID,
} as const;

/** The code of a handled refusal, or the error itself when it is not one. */
async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : error;
  }
  return null;
}

describe("given an aggregate project", () => {
  describe("when an access token bound to the aggregate is minted", () => {
    it("refuses the aggregate and mints nothing", async () => {
      const { lifecycle, repository, attachBindings } = harness();

      expect(
        await codeOf(() =>
          lifecycle.create({
            name: "Initial API key",
            userId: ADMIN_ID,
            createdByUserId: ADMIN_ID,
            organizationId: ORG_ID,
            permissionMode: "all",
            bindings: [AGGREGATE_BINDING],
          }),
        ),
      ).toBe("aggregate_project_has_no_credential");

      expect(await repository.findForOrganization({ organizationId: ORG_ID })).toEqual([]);
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when an existing key is re-pointed at the aggregate", () => {
    it("refuses the aggregate and writes no grant", async () => {
      const { lifecycle, repository, attachBindings } = harness();
      const existing = await repository.create({
        name: "a key",
        description: null,
        lookupId: "lookup-1",
        hashedSecret: "hashed",
        permissionMode: "all",
        userId: ADMIN_ID,
        createdByUserId: ADMIN_ID,
        parentApiKeyId: null,
        organizationId: ORG_ID,
        expiresAt: null,
        ingestSourceType: null,
        ingestionTemplateId: null,
        isSystemManaged: false,
        startsDisabled: false,
        grants: [],
      });

      expect(
        await codeOf(() =>
          lifecycle.update({
            id: existing.id,
            organizationId: ORG_ID,
            callerUserId: ADMIN_ID,
            callerIsAdmin: true,
            bindings: [AGGREGATE_BINDING],
          }),
        ),
      ).toBe("aggregate_project_has_no_credential");

      expect(attachBindings).not.toHaveBeenCalled();
    });
  });
});
