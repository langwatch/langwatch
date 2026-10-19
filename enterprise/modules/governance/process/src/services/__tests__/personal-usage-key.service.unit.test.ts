// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The rollup a personal API key reads, scoped to this organization's governance tenant.
 * Spec: specs/ai-gateway/governance/me-usage-rest-api.feature
 */
import type {
  MePersonalCredential,
  PersonalUsageQueryInput,
  PersonalUsageRollup,
} from "@langwatch/enterprise-governance-contract";
import {
  type OrganizationApi,
  OrganizationNotFoundForTeamError,
} from "@langwatch/organization-contract";
import {
  type InternalProject,
  PROJECT_KIND,
  type ProjectApi,
  type ProjectIdentity,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { PersonalUsageKeyService } from "../../features/personal/services/personal-usage-key.service.ts";

const ORGANIZATION_ID = "org-1";

const personalProject: ProjectIdentity = {
  id: "project-personal-1",
  name: "Ada",
  slug: "ada",
  teamId: "team-personal-1",
  organizationId: ORGANIZATION_ID,
  isPersonal: true,
  ownerUserId: "user-1",
  kind: "application",
};

const governanceProject: InternalProject = {
  id: "project-governance-1",
  name: "Governance",
  slug: "governance",
  teamId: "team-governance-1",
  kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
  archivedAtMs: null,
  traceSharingEnabled: false,
};

const rollup: PersonalUsageRollup = {
  summary: {
    spentUsd: 5,
    billedUsd: 5,
    requests: 3,
    promptTokens: 30,
    completionTokens: 15,
    mostUsedModel: { name: "claude-opus", usagePct: 67 },
  },
  dailyBuckets: [{ day: "2026-09-01", spentUsd: 5, billedUsd: 5, requests: 3 }],
  breakdownByModel: [{ label: "claude-opus", spentUsd: 5, billedUsd: 5, requests: 3 }],
};

function service({
  project = personalProject,
  tenant = governanceProject,
  organizationIdOfTeam = async () => ORGANIZATION_ID,
}: {
  project?: ProjectIdentity;
  tenant?: InternalProject | null;
  organizationIdOfTeam?: OrganizationApi["getOrganizationIdByTeamId"];
} = {}) {
  const findInternal = vi.fn(async () => tenant);
  const personalCallerFor = vi.fn<UserApi["personalCallerFor"]>(
    ({ project: owned }) => owned.ownerUserId ?? "",
  );
  const personalUsage = vi.fn(async (_input: PersonalUsageQueryInput) => rollup);
  const keys = PersonalUsageKeyService.create({
    projects: createApiFixture<ProjectApi>({ findIdentity: async () => project, findInternal }),
    organizations: createApiFixture<OrganizationApi>({
      getOrganizationIdByTeamId: organizationIdOfTeam,
    }),
    users: createApiFixture<UserApi>({ personalCallerFor }),
    rollups: { rollup: personalUsage },
  });

  return { keys, findInternal, personalCallerFor, personalUsage };
}

const read = (keys: PersonalUsageKeyService, credential: MePersonalCredential) =>
  keys.read({ projectId: personalProject.id, credential });

describe("PersonalUsageKeyService", () => {
  describe("when the member's own key reads its usage", () => {
    /** @scenario "Ingestion-source spend is included and scoped to this organization" */
    it("rolls up against this organization's governance project", async () => {
      const { keys, findInternal, personalUsage } = service();

      const usage = await read(keys, {
        kind: "apiKey",
        userId: "user-1",
        organizationId: ORGANIZATION_ID,
      });

      expect(usage).toEqual(rollup);
      expect(findInternal).toHaveBeenCalledWith({
        organizationId: ORGANIZATION_ID,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      });
      expect(personalUsage).toHaveBeenCalledWith({
        personalProjectId: personalProject.id,
        userId: "user-1",
        ingestionTenantId: governanceProject.id,
      });
    });

    it("asks user whether the key's member owns the workspace", async () => {
      const { keys, personalCallerFor } = service();

      await read(keys, { kind: "cliAccessToken", userId: "user-1", organizationId: "org-1" });

      expect(personalCallerFor).toHaveBeenCalledWith({
        project: personalProject,
        callerUserId: "user-1",
      });
    });
  });

  describe("when a legacy key reads where no governance project was minted", () => {
    it("reads the personal project alone, over the requested window", async () => {
      const { keys, personalUsage } = service({ tenant: null });

      await keys.read({
        projectId: personalProject.id,
        credential: { kind: "legacyProjectKey" },
        window: { startMs: 1_000, endMs: 2_000 },
      });

      expect(personalUsage).toHaveBeenCalledWith({
        personalProjectId: personalProject.id,
        userId: "user-1",
        window: { startMs: 1_000, endMs: 2_000 },
      });
    });
  });

  describe("when the workspace's team belongs to no organization", () => {
    it("reads the personal project alone", async () => {
      const { keys, findInternal, personalUsage } = service({
        organizationIdOfTeam: async () => {
          throw new OrganizationNotFoundForTeamError(personalProject.teamId);
        },
      });

      await read(keys, { kind: "legacyProjectKey" });

      expect(findInternal).not.toHaveBeenCalled();
      expect(personalUsage).toHaveBeenCalledWith({
        personalProjectId: personalProject.id,
        userId: "user-1",
      });
    });
  });

  describe("when the key cannot answer for a person", () => {
    it("refuses a service key, which belongs to nobody", async () => {
      const { keys, personalUsage } = service();

      await expect(
        read(keys, { kind: "apiKey", userId: null, organizationId: ORGANIZATION_ID }),
      ).rejects.toMatchObject({ code: "personal_usage_service_key_unsupported" });
      expect(personalUsage).not.toHaveBeenCalled();
    });

    it("refuses a key from a shared workspace", async () => {
      const { keys } = service({ project: { ...personalProject, isPersonal: false } });

      await expect(read(keys, { kind: "legacyProjectKey" })).rejects.toMatchObject({
        code: "personal_project_key_required",
      });
    });
  });
});
