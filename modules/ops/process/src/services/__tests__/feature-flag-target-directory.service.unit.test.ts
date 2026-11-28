/**
 * @vitest-environment node
 * The rules dialog's target search, composed from each owner's Api.
 * @see modules/ops/specs/feature-flag-target-search.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { opsSearchFeatureFlagTargetsInputSchema } from "@langwatch/ops-contract";
import type {
  OrganizationApi,
  OrganizationOperatorSummary,
} from "@langwatch/organization-contract";
import type { ProjectApi, ProjectIdentity } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { FeatureFlagTargetDirectoryService } from "../feature-flag-target-directory.service.ts";

const labsOld: OrganizationOperatorSummary = {
  id: "organization_old",
  name: "Acme Labs",
  slug: "acme-labs",
  createdAt: Temporal.Instant.from("2025-02-01T00:00:00Z"),
  memberCount: 12,
  administratorEmails: ["owner@acme.test"],
};
const labsNew: OrganizationOperatorSummary = {
  id: "organization_new",
  name: "Acme Labs",
  slug: "acme-labs-2",
  createdAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  memberCount: 1,
  administratorEmails: [],
};
const directory = [labsOld, labsNew];

const checkout: ProjectIdentity = {
  id: "project_checkout",
  name: "Checkout bot",
  slug: "checkout-bot",
  teamId: "team_1",
  organizationId: labsOld.id,
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

const dana: UserProfile = {
  id: "user_dana",
  name: "Dana",
  email: "dana@acme.test",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: null,
};

function service() {
  return FeatureFlagTargetDirectoryService.create({
    organizations: createApiFixture<
      Pick<OrganizationApi, "searchForOperators" | "findForOperators" | "organizationIdsForMember">
    >({
      searchForOperators: async ({ query }) =>
        directory.filter((summary) => summary.name.toLowerCase().includes(query.toLowerCase())),
      findForOperators: async ({ organizationIds }) =>
        directory.filter((summary) => organizationIds.includes(summary.id)),
      organizationIdsForMember: async ({ userId }) => (userId === dana.id ? [labsOld.id] : []),
    }),
    projects: createApiFixture<Pick<ProjectApi, "searchByQuery" | "listNamesByIds">>({
      searchByQuery: async ({ query }) =>
        checkout.name.toLowerCase().includes(query) ? [checkout] : [],
      listNamesByIds: async ({ projectIds }) =>
        projectIds.includes(checkout.id) ? [checkout] : [],
    }),
    users: createApiFixture<Pick<UserApi, "searchForOperators" | "getProfiles">>({
      searchForOperators: async ({ query }) => (dana.email?.includes(query) ? [dana] : []),
      getProfiles: async ({ userIds }) =>
        userIds.includes(dana.id)
          ? [{ ...dana, lastHomePath: null, tracesExplorerTourDismissedAt: null }]
          : [],
    }),
    plans: createApiFixture<Pick<EntitlementApi, "getActivePlan">>({
      getActivePlan: async ({ organizationId }) => {
        if (organizationId === labsNew.id) throw new Error("plan source down");
        return { name: "Growth" } as Awaited<ReturnType<EntitlementApi["getActivePlan"]>>;
      },
    }),
  });
}

describe("when an operator searches organizations", () => {
  /** @scenario "an operator finds an organization by name, slug or id" */
  it("lists both organizations of the same name with what tells them apart", async () => {
    const targets = await service().search({ kind: "organization", query: "acme" });

    expect(targets).toEqual([
      {
        kind: "organization",
        id: labsOld.id,
        name: "Acme Labs",
        slug: "acme-labs",
        createdAtMs: labsOld.createdAt.epochMilliseconds,
        memberCount: 12,
        planName: "Growth",
        administratorEmails: ["owner@acme.test"],
      },
      expect.objectContaining({ id: labsNew.id, slug: "acme-labs-2", planName: null }),
    ]);
  });
});

describe("when an operator searches projects", () => {
  /** @scenario "an operator finds a project by name, slug or id" */
  it("lists the project with its organization", async () => {
    await expect(service().search({ kind: "project", query: "checkout" })).resolves.toEqual([
      {
        kind: "project",
        id: checkout.id,
        name: "Checkout bot",
        slug: "checkout-bot",
        organization: { id: labsOld.id, name: "Acme Labs", slug: "acme-labs" },
      },
    ]);
  });
});

describe("when an operator searches users", () => {
  /** @scenario "an operator finds a user by email, name or id" */
  it("lists the user with their email, name and organizations", async () => {
    await expect(service().search({ kind: "user", query: "dana@" })).resolves.toEqual([
      {
        kind: "user",
        id: dana.id,
        name: "Dana",
        email: "dana@acme.test",
        organizations: [{ id: labsOld.id, name: "Acme Labs", slug: "acme-labs" }],
      },
    ]);
  });
});

describe("when the stored rules name targets by id", () => {
  /** @scenario "stored rule targets render with their names" */
  it("resolves every known id and leaves out the ones nothing answers for", async () => {
    const targets = await service().find({
      organizationIds: [labsNew.id, "organization_gone"],
      projectIds: [checkout.id, "project_gone"],
      userIds: [dana.id],
    });

    expect(targets.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
      `organization:${labsNew.id}`,
      `project:${checkout.id}`,
      `user:${dana.id}`,
    ]);
  });

  it("asks no owner when the rules name nothing", async () => {
    await expect(
      service().find({ organizationIds: [], projectIds: [], userIds: [] }),
    ).resolves.toEqual([]);
  });
});

describe("when the query is empty", () => {
  /** @scenario "a search with an empty query is refused" */
  it("rejects the input before any owner is asked", () => {
    expect(
      opsSearchFeatureFlagTargetsInputSchema.validate({ kind: "organization", query: "  " }),
    ).toBe(false);
  });
});
