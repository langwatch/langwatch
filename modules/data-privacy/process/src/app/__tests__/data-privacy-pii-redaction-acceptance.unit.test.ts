/**
 * @vitest-environment node
 * An organization admin's acceptance of the PII redaction model's price, through the app: the
 * snapshot the Data Privacy page reads says whether it was given, and accepting records it on
 * the organization. Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */
import type { AuthzApi, AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryDataPrivacyDirectoryRepository } from "../../repositories/memory/memory.data-privacy-directory.repository.ts";
import { createDataPrivacyTestApp, dataPrivacyTestGraph } from "./data-privacy.fixture.ts";

const { projectId, teamId, organizationId } = dataPrivacyTestGraph;
const USER_ID = "admin-1";

const permissions = createApiFixture<AuthzApi>({
  hasPermission: async () => true,
  checkScopeLineage: async () => ({ kind: "consistent" }),
  canBatchByIds: async (input: AuthzCanBatchByIdsInput) => ({
    teams: new Map(input.teams.map((team) => [team.teamId, true])),
    projects: new Map(input.projects.map((project) => [project.projectId, true])),
    organizationRole: null,
  }),
});

/** The app over a project that sits in `organization`, or in no organization at all. */
async function appFor({
  accepted,
  organization,
}: {
  accepted: boolean;
  organization: string | null;
}) {
  const reads: string[] = [];
  const recorded: { organizationId: string; userId: string }[] = [];
  const organizations = createApiFixture<OrganizationApi>({
    isPiiRedactionModelAccepted: async (input) => {
      reads.push(input.organizationId);
      return accepted;
    },
    recordPiiRedactionModelAcceptance: async (input) => {
      recorded.push(input);
    },
  });
  const app = await createDataPrivacyTestApp({
    directory: MemoryDataPrivacyDirectoryRepository.create({
      lineage: {
        projectId,
        name: "Acme production",
        teamId: organization ? teamId : null,
        organizationId: organization,
        organizationName: organization ? "Acme" : null,
      },
    }),
    dependencies: {
      permissions,
      featureFlags: createApiFixture<FeatureFlagApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations,
    },
  });
  return { app, reads, recorded };
}

describe("given the Data Privacy page's snapshot", () => {
  describe.each([
    { state: "has accepted", accepted: true },
    { state: "has not accepted", accepted: false },
  ])("when the project's organization $state the model's price", ({ accepted }) => {
    /** @scenario "The page's snapshot says whether the organization accepted the price" */
    it("says so", async () => {
      const { app, reads } = await appFor({ accepted, organization: organizationId });

      const snapshot = await app.getSnapshot({ projectId, userId: USER_ID });

      expect(snapshot.piiRedactionModelAccepted).toBe(accepted);
      expect(reads).toEqual([organizationId]);
    });
  });

  describe("when the project is a personal one, with no organization", () => {
    /** @scenario "The page's snapshot says whether the organization accepted the price" */
    it("reads as not accepted without asking", async () => {
      const { app, reads } = await appFor({ accepted: true, organization: null });

      const snapshot = await app.getSnapshot({ projectId, userId: USER_ID });

      expect(snapshot.piiRedactionModelAccepted).toBe(false);
      expect(reads).toEqual([]);
    });
  });
});

describe("given an organization admin accepting the model's price", () => {
  /** @scenario "Only an organization admin can accept the price" */
  it("records the acceptance on the organization, naming the admin", async () => {
    const { app, recorded } = await appFor({ accepted: false, organization: organizationId });

    await app.acceptPiiRedactionModel({ organizationId, userId: USER_ID });

    expect(recorded).toEqual([{ organizationId, userId: USER_ID }]);
  });
});
