// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The CLI's personal-project read and key issue while project is still creating the personal project.
 * @see specs/ai-gateway/governance/cli-login.feature
 */
import { PersonalVirtualKeyAlreadyExistsError } from "@langwatch/enterprise-gateway-contract";
import {
  PersonalWorkspacePendingError,
  type EnsuredPersonalWorkspace,
} from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  GovernanceCliCredentialService,
  type GovernanceCliCredentialMembers,
} from "../../features/cli/services/governance-cli-credentials.service.ts";

const caller = {
  user_id: "user_1",
  organization_id: "org_1",
  token_key: "token_1",
  cli_api_key_id: "login_1",
};

const TEAM = { id: "team_personal", name: "Personal", slug: "personal", createdAtMs: 0 };
const READY: EnsuredPersonalWorkspace = {
  kind: "ready",
  workspace: {
    team: TEAM,
    project: {
      id: "project_personal",
      name: "Ada",
      slug: "personal-ada",
      apiKey: "key",
      createdAtMs: 0,
    },
  },
};
const PENDING: EnsuredPersonalWorkspace = {
  kind: "pending",
  team: TEAM,
};

/** The caller already holds the default key, so a key issue needs the personal project. */
function setup(
  ensured: EnsuredPersonalWorkspace,
  ensureDefault: () => Promise<never> = async () => {
    throw new PersonalVirtualKeyAlreadyExistsError("vk_default");
  },
) {
  const personalVirtualKeyIssue = vi.fn();
  const members: GovernanceCliCredentialMembers = {
    personalKeys: createApiFixture<GovernanceCliCredentialMembers["personalKeys"]>({
      personalVirtualKeyEnsureDefault: ensureDefault,
      personalVirtualKeyIssue,
    }),
    ingestionKeys: createApiFixture<GovernanceCliCredentialMembers["ingestionKeys"]>({}),
    aiTools: createApiFixture<GovernanceCliCredentialMembers["aiTools"]>({}),
    users: createApiFixture<GovernanceCliCredentialMembers["users"]>({
      findById: async () => null,
    }),
    projects: createApiFixture<GovernanceCliCredentialMembers["projects"]>({}),
    supportContacts: () => {
      throw new Error("supportContacts was not expected");
    },
    ensurePersonalWorkspace: async () => ensured,
    getPersonalWorkspace: async () => {
      throw new Error("getPersonalWorkspace was not expected");
    },
    permittedOnProject: async () => {
      throw new Error("permittedOnProject was not expected");
    },
    budgets: createApiFixture<GovernanceCliCredentialMembers["budgets"]>({}),
    publicBaseUrl: "https://app.test",
  };

  return { service: GovernanceCliCredentialService.create(members), personalVirtualKeyIssue };
}

describe("GovernanceCliCredentialService and a pending personal project", () => {
  describe("when resolving the personal project", () => {
    it("names the personal project once it exists", async () => {
      const { service } = setup(READY);

      await expect(service.resolvePersonalProject(caller)).resolves.toEqual({
        outcome: "resolved",
        project: { id: "project_personal", slug: "personal-ada", name: "Ada" },
      });
    });

    /** @scenario "The CLI personal-project read answers failed while the personal project is still being created" */
    it("answers failed while the personal project is still being created", async () => {
      const { service } = setup(PENDING);

      await expect(service.resolvePersonalProject(caller)).resolves.toEqual({ outcome: "failed" });
    });
  });

  describe("when issuing a personal virtual key", () => {
    /** @scenario "The CLI key route refuses with a retryable 409 while the personal workspace is set up" */
    it("refuses a device key as retryable while the personal project is still being created", async () => {
      const { service, personalVirtualKeyIssue } = setup(PENDING);

      await expect(
        service.issuePersonalVirtualKey({ caller, deviceLabel: undefined }),
      ).rejects.toMatchObject({
        code: "personal_workspace_pending",
        httpStatus: 409,
        retryable: true,
      });
      expect(personalVirtualKeyIssue).not.toHaveBeenCalled();
    });

    /** @scenario "The CLI key route refuses with a retryable 409 while the personal workspace is set up" */
    it("passes on the gateway's pending refusal of the default key", async () => {
      const { service } = setup(READY, async () => {
        throw new PersonalWorkspacePendingError();
      });

      await expect(
        service.issuePersonalVirtualKey({ caller, deviceLabel: undefined }),
      ).rejects.toBeInstanceOf(PersonalWorkspacePendingError);
    });
  });
});
