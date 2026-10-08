/**
 * @vitest-environment node
 * ADR-175 decision 5: an aggregate reads other people's personal projects, so
 * `organization.getAll` lists it to an administrator of ITS organisation and to
 * nobody else. It receives no traces of its own, so it reads as having traces.
 */
import type { AuthzApi, AuthzBindingForSynthesis } from "@langwatch/authz-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { OrganizationVisibilityService } from "../organization-visibility.service.ts";

const CALLER = { id: "user-1" };
const T0 = Temporal.Instant.fromEpochMilliseconds(0);

type OrganizationRole = "ADMIN" | "MEMBER";

/** One organisation whose only team, the caller's, holds an ordinary project and an aggregate. */
function seedOrganization({
  memory,
  organizationId,
  role,
}: {
  memory: MemoryOrganizationDatabase;
  organizationId: string;
  role: OrganizationRole;
}): void {
  const teamId = `${organizationId}-team`;
  memory.organizations.set(organizationId, {
    id: organizationId,
    name: organizationId,
    slug: organizationId,
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.organizationUsers.push({
    userId: CALLER.id,
    organizationId,
    role,
    disabledAt: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.teams.set(teamId, {
    id: teamId,
    name: teamId,
    slug: teamId,
    organizationId,
    isPersonal: false,
    ownerUserId: null,
    archivedAt: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.teamUsers.push({
    teamId,
    userId: CALLER.id,
    role: "MEMBER",
    customRoleId: null,
    createdAt: T0,
    updatedAt: T0,
  });
  for (const kind of [PROJECT_KIND.APPLICATION, PROJECT_KIND.AGGREGATE]) {
    const id = `${organizationId}-${kind}`;
    memory.projects.set(id, {
      id,
      name: id,
      slug: id,
      apiKey: `sk-lw-${id}`,
      lwqlKey: `lwql-${id}`,
      kind,
      teamId,
      isPersonal: false,
      ownerUserId: null,
      organizationId,
      archivedAt: null,
      createdAt: T0,
      updatedAt: T0,
      personalFeatures: null,
    });
  }
}

function adminBinding(organizationId: string): AuthzBindingForSynthesis {
  return {
    organizationId,
    scopeType: "ORGANIZATION",
    scopeId: organizationId,
    role: "ADMIN",
    customRoleId: null,
    customRole: null,
  };
}

/** Every project the caller receives, by organisation, as `organization.getAll` answers. */
async function projectsReceived({
  organizations,
  bindings = [],
}: {
  organizations: Readonly<Record<string, OrganizationRole>>;
  bindings?: AuthzBindingForSynthesis[];
}) {
  const memory = MemoryOrganizationDatabase.create();
  for (const [organizationId, role] of Object.entries(organizations)) {
    seedOrganization({ memory, organizationId, role });
  }
  const membership = MemoryOrganizationMembershipRepository.create({ memory });
  const service = OrganizationVisibilityService.create({
    reader: {
      getAllForUser: (input) => membership.findAllForUser(input),
      findOrganizationWithMembers: (input) => membership.findOrganizationWithMembers(input),
      findMemberById: (input) => membership.findMemberById(input),
    },
    permissions: createApiFixture<AuthzApi>({
      listBindingsForSynthesis: vi.fn(async () => bindings),
    }),
    demoProject: { userId: "", projectId: "" },
  });
  const received = await service.listVisible({ isDemo: false }, CALLER);

  return Object.fromEntries(
    received.map((organization) => [
      organization.id,
      organization.teams.flatMap((team) => team.projects),
    ]),
  );
}

describe("given an organisation whose caller's team holds an ordinary project and an aggregate", () => {
  describe("when a member who is not an administrator lists their organisations", () => {
    it("receives the ordinary project and not the aggregate", async () => {
      const received = await projectsReceived({ organizations: { "org-1": "MEMBER" } });

      expect(received["org-1"]?.map((project) => project.id)).toEqual(["org-1-application"]);
    });
  });

  describe("when an organisation administrator lists their organisations", () => {
    it("receives the aggregate beside the ordinary project", async () => {
      const received = await projectsReceived({ organizations: { "org-1": "ADMIN" } });

      expect(received["org-1"]?.map((project) => project.id)).toEqual([
        "org-1-application",
        "org-1-aggregate",
      ]);
    });

    it("reads the aggregate as having traces, and leaves the ordinary project's flag alone", async () => {
      const received = await projectsReceived({ organizations: { "org-1": "ADMIN" } });
      const firstMessage = (id: string) =>
        received["org-1"]?.find((project) => project.id === id)?.firstMessage;

      expect(firstMessage("org-1-aggregate")).toBe(true);
      expect(firstMessage("org-1-application")).toBe(false);
    });

    it("carries neither stored key of the aggregate", async () => {
      const received = await projectsReceived({ organizations: { "org-1": "ADMIN" } });
      const aggregate = received["org-1"]?.find((project) => project.id === "org-1-aggregate");

      expect(aggregate?.apiKey).toBe("");
      expect(aggregate?.lwqlKey).toBe("");
    });
  });

  describe("when an administrator binding names a caller whose row says member", () => {
    it("receives the aggregate", async () => {
      const received = await projectsReceived({
        organizations: { "org-1": "MEMBER" },
        bindings: [adminBinding("org-1")],
      });

      expect(received["org-1"]?.map((project) => project.id)).toContain("org-1-aggregate");
    });
  });

  describe("when the caller administers one organisation and is a member of another", () => {
    it("receives the aggregate of the first only", async () => {
      const received = await projectsReceived({
        organizations: { "org-admin": "ADMIN", "org-member": "MEMBER" },
      });

      expect(received["org-admin"]?.map((project) => project.id)).toContain("org-admin-aggregate");
      expect(received["org-member"]?.map((project) => project.id)).toEqual([
        "org-member-application",
      ]);
    });
  });

  describe("when the organisation also holds its internal governance project", () => {
    it("receives it nowhere, administrator or not", async () => {
      const memory = MemoryOrganizationDatabase.create();
      seedOrganization({ memory, organizationId: "org-1", role: "ADMIN" });
      memory.projects.set("org-1-governance", {
        id: "org-1-governance",
        name: "Governance",
        slug: "org-1-governance",
        apiKey: "sk-lw-governance",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        teamId: "org-1-team",
        isPersonal: false,
        ownerUserId: null,
        organizationId: "org-1",
        archivedAt: null,
        createdAt: T0,
        updatedAt: T0,
        personalFeatures: null,
      });
      const membership = MemoryOrganizationMembershipRepository.create({ memory });

      const [organization] = await membership.findAllForUser({
        userId: CALLER.id,
        isDemo: false,
        demoProjectUserId: "",
        demoProjectId: "",
      });

      expect(organization?.teams.flatMap((team) => team.projects.map(({ id }) => id))).toEqual([
        "org-1-application",
        "org-1-aggregate",
      ]);
    });
  });
});
