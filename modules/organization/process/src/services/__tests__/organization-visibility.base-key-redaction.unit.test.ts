/**
 * @vitest-environment node
 *
 * A query never carries a credential: the organizations payload is cached, so the
 * project base key, the LangWatchQL key and the S3 secret never travel in it.
 * @see specs/api-keys/project-key-read-access.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryOrganizationMembershipRepository } from "../../repositories/memory/memory.organization-membership.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { OrganizationVisibilityService } from "../organization-visibility.service.ts";

const BASE_API_KEY = "test-base-key";
const STORED_LWQL_KEY = "test-lwql-key";
const STORED_S3_SECRET = "test-s3-secret";
const STORED_LICENSE = "test-licence-key";
const CALLER = { id: "user-1" };

const T0 = Temporal.Instant.fromEpochMilliseconds(0);

/** One organization with the two stored keys on its only project, in the memory twin. */
function seededMembership(): MemoryOrganizationMembershipRepository {
  const memory = MemoryOrganizationDatabase.create();
  memory.organizations.set("org-1", {
    id: "org-1",
    name: "Base Key Org",
    slug: "base-key-org",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: "https://s3.example.test",
    s3AccessKeyId: "test-s3-access-key-id",
    s3SecretAccessKey: STORED_S3_SECRET,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.organizationUsers.push({
    userId: CALLER.id,
    organizationId: "org-1",
    role: "MEMBER",
    disabledAt: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.teams.set("team-1", {
    id: "team-1",
    name: "Team",
    slug: "team",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
    archivedAt: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.teamUsers.push({
    teamId: "team-1",
    userId: CALLER.id,
    role: "MEMBER",
    customRoleId: null,
    createdAt: T0,
    updatedAt: T0,
  });
  memory.projects.set("project-1", {
    id: "project-1",
    name: "Project",
    slug: "project",
    apiKey: BASE_API_KEY,
    lwqlKey: STORED_LWQL_KEY,
    teamId: "team-1",
    isPersonal: false,
    ownerUserId: null,
    organizationId: "org-1",
    archivedAt: null,
    createdAt: T0,
    personalFeatures: null,
  });
  return MemoryOrganizationMembershipRepository.create({ memory });
}

/**
 * Grants exactly the permissions in `granted`. `organization:manage` is
 * never granted here — the base key is gated on the project, not on the organization.
 */
function testPermissions(granted: readonly string[]) {
  return {
    hasPermission: vi.fn(async (check: { permission: string }) =>
      granted.includes(check.permission),
    ),
    canBatchByIds: vi.fn(
      async (batch: { permission: string; projects: readonly { projectId: string }[] }) => ({
        teams: new Map<string, boolean>(),
        projects: new Map(
          batch.projects.map(({ projectId }) => [projectId, granted.includes(batch.permission)]),
        ),
        organizationRole: null,
      }),
    ),
    listBindingsForSynthesis: vi.fn(async () => []),
  };
}

function visibility(granted: readonly string[], permissions = testPermissions(granted)) {
  const membership = seededMembership();
  return OrganizationVisibilityService.create({
    reader: {
      getAllForUser: async (input) =>
        (await membership.findAllForUser(input)).map((organization) => ({
          ...organization,
          license: STORED_LICENSE,
        })),
      findOrganizationWithMembers: (input) => membership.findOrganizationWithMembers(input),
      findMemberById: (input) => membership.findMemberById(input),
    },
    permissions: createApiFixture<AuthzApi>(permissions),
    secrets: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    demoProject: { userId: "", projectId: "" },
  });
}

/** The only organization the caller belongs to. */
async function readOrganization(granted: readonly string[]) {
  const organizations = await visibility(granted).listVisible({ isDemo: false }, CALLER);
  const organization = organizations[0];

  if (!organization)
    throw new Error("the redaction dropped the organization it was meant to redact");

  return organization;
}

/** The only project in the only team of the only organization. */
async function readProject(granted: readonly string[]) {
  const organizations = await visibility(granted).listVisible({ isDemo: false }, CALLER);
  const project = organizations[0]?.teams[0]?.projects[0];

  if (!project) throw new Error("the redaction dropped the project it was meant to redact");

  return project;
}

describe("given the base key in the organizations payload", () => {
  describe.each([
    ["can manage the project", ["project:manage", "organization:manage"]],
    ["can update but not manage the project", ["project:update"]],
    ["can only view the project", []],
  ])("when the caller %s", (_label, granted) => {
    /** @scenario No query carries a project key or the storage secret */
    it("leaves the base key blank in the payload", async () => {
      const project = await readProject(granted);

      expect(project.apiKey).toBe("");
    });

    /** @scenario No query carries a project key or the storage secret */
    it("leaves the organization's S3 secret out of the payload and keeps the key id", async () => {
      const organization = await readOrganization(granted);

      expect(organization.s3SecretAccessKey).toBeNull();
      expect(organization.s3AccessKeyId).toBe("test-s3-access-key-id");
    });

    /** @scenario No query carries a project key or the storage secret */
    it("leaves the uploaded licence key out of the payload", async () => {
      const organization = await readOrganization(granted);

      expect(organization.license).toBeNull();
      expect(JSON.stringify(organization)).not.toContain(STORED_LICENSE);
    });
  });

  /** The LangWatchQL key is a control-plane secret withheld from everyone, managers included. */
  describe("when the LangWatchQL key is on the project", () => {
    /** @scenario No query carries a project key or the storage secret */
    it.each([
      ["a caller who can manage the project", ["project:manage"]],
      ["a caller who can update but not manage the project", ["project:update"]],
      ["a caller who can only view the project", []],
    ])("withholds it from the payload for %s", async (_label, granted) => {
      const project = await readProject(granted);

      expect(project.lwqlKey).toBe("");
    });
  });
});
