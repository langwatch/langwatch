import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageQueryInput,
  PersonalUsageSummary,
} from "@langwatch/enterprise-governance-contract";
// Personal usage dashboard: resolves which tenants a member sees (personal
// workspace, governance project), returns empty on signup.
import { TeamNotFoundError } from "@langwatch/organization-contract";
import type { InternalProject } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import {
  PersonalUsageDashboardService,
  type PersonalUsageDashboardServiceOptions,
} from "../personal-usage-dashboard.service.ts";

const USER_ID = "user-1";
const ORGANIZATION_ID = "org-1";
const PERSONAL_PROJECT_ID = "project-personal";
const GOVERNANCE_PROJECT_ID = "project-governance";

const summary: PersonalUsageSummary = {
  spentUsd: 12.5,
  billedUsd: 14,
  requests: 7,
  promptTokens: 900,
  completionTokens: 300,
  mostUsedModel: { name: "claude-opus", usagePct: 80 },
};
const buckets: PersonalUsageBucket[] = [
  { day: "2026-08-01", spentUsd: 12.5, billedUsd: 14, requests: 7 },
];
const breakdown: PersonalUsageBreakdown[] = [
  { label: "claude-opus", spentUsd: 12.5, billedUsd: 14, requests: 7 },
];

const governanceProject: InternalProject = {
  id: GOVERNANCE_PROJECT_ID,
  name: "Governance",
  slug: "governance",
  teamId: "team-governance",
  kind: "internal_governance",
  archivedAtMs: null,
  traceSharingEnabled: false,
};

const personalWorkspace = {
  team: { id: "team-personal", name: "Personal", slug: "personal", createdAtMs: 0 },
  project: {
    id: PERSONAL_PROJECT_ID,
    name: "Personal",
    slug: "personal",
    apiKey: "sk-lw-personal",
    createdAtMs: 0,
  },
};

/** A member who has one, unless the test says otherwise. */
function build(
  options: {
    workspace?: typeof personalWorkspace | null;
    internalProject?: InternalProject | null;
  } = {},
) {
  const personalUsageSummary = vi.fn(async (_: PersonalUsageQueryInput) => summary);
  const personalUsageDailyBuckets = vi.fn(async (_: PersonalUsageQueryInput) => buckets);
  const personalUsageBreakdownByModel = vi.fn(async (_: PersonalUsageQueryInput) => breakdown);
  const getPersonalWorkspace = vi.fn(async () => {
    const workspace = options.workspace === undefined ? personalWorkspace : options.workspace;
    if (!workspace) throw new TeamNotFoundError();
    return workspace;
  });
  const findInternal = vi.fn(async () =>
    options.internalProject === undefined ? governanceProject : options.internalProject,
  );

  const dependencies: PersonalUsageDashboardServiceOptions = {
    governance: {
      personalUsageSummary,
      personalUsageDailyBuckets,
      personalUsageBreakdownByModel,
    },
    organizations: { getPersonalWorkspace },
    projects: { findInternal },
  };

  return {
    personalUsageSummary,
    personalUsageDailyBuckets,
    personalUsageBreakdownByModel,
    getPersonalWorkspace,
    findInternal,
    service: PersonalUsageDashboardService.create(dependencies),
  };
}

describe("PersonalUsageDashboardService", () => {
  describe("given a member with no personal workspace yet", () => {
    describe("when their dashboard is read", () => {
      it("answers zeros rather than refusing, so the page renders before their first request", async () => {
        const { service } = build({ workspace: null });

        expect(await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID })).toEqual({
          summary: {
            spentUsd: 0,
            billedUsd: 0,
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            mostUsedModel: null,
          },
          dailyBuckets: [],
          breakdownByModel: [],
        });
      });

      it("asks the analytics store nothing, because there is no tenant to ask about", async () => {
        const { service, personalUsageSummary, findInternal } = build({ workspace: null });

        await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID });

        expect(personalUsageSummary).not.toHaveBeenCalled();
        expect(findInternal).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a member whose organization has a governance project", () => {
    describe("when their dashboard is read", () => {
      it("unions their personal tenant with the ingestion rows recorded against them", async () => {
        const { service, personalUsageSummary } = build();

        await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID });

        expect(personalUsageSummary).toHaveBeenCalledWith({
          personalProjectId: PERSONAL_PROJECT_ID,
          window: undefined,
          userId: USER_ID,
          ingestionTenantId: GOVERNANCE_PROJECT_ID,
        });
      });

      it("asks all three questions about the same tenants", async () => {
        const {
          service,
          personalUsageSummary,
          personalUsageDailyBuckets,
          personalUsageBreakdownByModel,
        } = build();

        await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID });

        const [query] = personalUsageSummary.mock.calls[0]!;
        expect(personalUsageDailyBuckets).toHaveBeenCalledWith(query);
        expect(personalUsageBreakdownByModel).toHaveBeenCalledWith(query);
      });

      it("resolves the governance project read-only, never provisioning one", async () => {
        const { service, findInternal } = build();

        await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID });

        expect(findInternal).toHaveBeenCalledWith({
          organizationId: ORGANIZATION_ID,
          kind: "internal_governance",
        });
      });

      it("returns the three answers under one shape", async () => {
        const { service } = build();

        expect(await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID })).toEqual({
          summary,
          dailyBuckets: buckets,
          breakdownByModel: breakdown,
        });
      });
    });

    describe("when a window is named", () => {
      it("carries it into every read", async () => {
        const { service, personalUsageBreakdownByModel } = build();
        const window = { startMs: 1, endMs: 2 };

        await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID, window });

        expect(personalUsageBreakdownByModel).toHaveBeenCalledWith(
          expect.objectContaining({ window }),
        );
      });
    });
  });

  describe("given an organization with no governance project", () => {
    describe("when the dashboard is read", () => {
      it("reads the personal tenant alone", async () => {
        const { service, personalUsageSummary } = build({ internalProject: null });

        await service.read({ userId: USER_ID, organizationId: ORGANIZATION_ID });

        expect(personalUsageSummary).toHaveBeenCalledWith({
          personalProjectId: PERSONAL_PROJECT_ID,
          window: undefined,
          userId: USER_ID,
          ingestionTenantId: undefined,
        });
      });
    });
  });

  describe("given a query whose tenants the caller already resolved", () => {
    describe("when it is rolled up", () => {
      it("issues the three reads without resolving anything again", async () => {
        const { service, getPersonalWorkspace, personalUsageSummary } = build();
        const query = { personalProjectId: PERSONAL_PROJECT_ID, userId: USER_ID };

        const rollup = await service.rollup(query);

        expect(getPersonalWorkspace).not.toHaveBeenCalled();
        expect(personalUsageSummary).toHaveBeenCalledWith(query);
        expect(rollup).toEqual({
          summary,
          dailyBuckets: buckets,
          breakdownByModel: breakdown,
        });
      });
    });
  });
});
