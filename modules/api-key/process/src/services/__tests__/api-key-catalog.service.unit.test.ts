/**
 * The projects a key may name as its scope. An aggregate receives no traces and accepts no
 * credential (ADR-175 decision 7), so it is never offered, even to an organisation admin.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyCatalogService } from "../api-key-catalog.service.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";
import type { ApiKeyGrantId } from "../api-key.service.ts";

const ORG_ID = "organization-1";
const EPOCH = new Date("2026-01-01T00:00:00Z");

const project = ({ id, kind }: { id: string; kind: string }): Project => ({
  id,
  name: id,
  slug: id,
  apiKey: "",
  lwqlKey: "",
  teamId: "team-1",
  language: "other",
  framework: "other",
  kind,
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
});

const ORGANIZATION_PROJECTS = [
  project({ id: "shared-1", kind: "application" }),
  project({ id: "aggregate-1", kind: "aggregate" }),
];

/** The catalog over a project listing that honours the audience it is asked for. */
function catalog(): ApiKeyCatalogService {
  const authz = createApiFixture<AuthzApi>();
  const projects = createApiFixture<ProjectApi>({
    listByOrganization: async ({ limit, aggregatesVisibleTo }) => {
      const data = ORGANIZATION_PROJECTS.filter(
        (listed) => listed.kind !== "aggregate" || aggregatesVisibleTo !== "nobody",
      );

      return { data, pagination: { page: 1, limit, total: data.length } };
    },
  });

  return ApiKeyCatalogService.create({
    authz,
    grants: authz,
    organizations: createApiFixture<OrganizationApi>(),
    projects,
    bindingIds: createApiFixture<ApiKeyGrantId>(),
    legacyGrants: { mint: () => void 0 },
    tokens: ApiKeyTokenService.create("test-pepper"),
    repository: MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
  });
}

describe("given an organisation holding an aggregate project", () => {
  describe("when an API key's project scopes are listed", () => {
    it("leaves the aggregate out", async () => {
      const ids = (await catalog().getOrgProjects({ organizationId: ORG_ID })).map(
        (listed) => listed.id,
      );

      expect(ids).toContain("shared-1");
      expect(ids).not.toContain("aggregate-1");
    });
  });
});
