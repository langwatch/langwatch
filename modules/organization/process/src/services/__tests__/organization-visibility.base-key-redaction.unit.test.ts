import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 *
 * Project base key in organization.getAll payload must be gated by permissions.
 * @see specs/api-keys/project-key-read-access.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FullyLoadedOrganization } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { OrganizationVisibilityService } from "../organization-visibility.service.ts";

const BASE_API_KEY = "test-base-key";
const STORED_LWQL_KEY = "test-lwql-key";
const CALLER = { id: "user-1" };

/** One organization, loaded, with the two stored keys on its only project. */
function organizationPayload(): FullyLoadedOrganization[] {
  return [
    {
      id: "org-1",
      name: "Base Key Org",
      members: [{ userId: "user-1", organizationId: "org-1", role: "MEMBER" }],
      teams: [
        {
          id: "team-1",
          members: [{ userId: "user-1", teamId: "team-1", role: "MEMBER" }],
          projects: [
            {
              id: "project-1",
              apiKey: BASE_API_KEY,
              lwqlKey: STORED_LWQL_KEY,
              s3AccessKeyId: null,
              s3SecretAccessKey: null,
              s3Endpoint: null,
            },
          ],
        },
      ],
    },
  ] as unknown as FullyLoadedOrganization[];
}

/**
 * Grants exactly the permissions in `granted`. `organization:manage` is
 * never granted here — the base key is gated on the project, not on the organization.
 */
function testPermissions(granted: readonly string[]): AuthzApi {
  return createApiFixture<AuthzApi>({
    hasPermission: vi.fn(async (check: { permission: string }) =>
      granted.includes(check.permission),
    ),
    listBindingsForSynthesis: vi.fn(async () => []),
  });
}

function visibility(granted: readonly string[]) {
  return OrganizationVisibilityService.create({
    reader: {
      getAllForUser: vi.fn(async () => organizationPayload()),
      findOrganizationWithMembers: vi.fn(async () => null),
      findMemberById: vi.fn(async () => null),
    },
    permissions: testPermissions(granted),
    secrets: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    demoProject: { userId: "", projectId: "" },
  });
}

/** The only project in the only team of the only organization. */
async function readProject(granted: readonly string[]) {
  const organizations = await visibility(granted).listVisible({ isDemo: false }, CALLER);
  const project = organizations[0]?.teams[0]?.projects[0];

  if (!project) throw new Error("the redaction dropped the project it was meant to redact");

  return project;
}

describe("given the base key in the organizations payload", () => {
  describe("when the caller can manage the project", () => {
    /** @scenario The base key stays in the session payload for project admins */
    it("includes the base key in the payload", async () => {
      const project = await readProject(["project:manage"]);

      expect(project.apiKey).toBe(BASE_API_KEY);
    });
  });

  describe("when the caller can update but not manage the project", () => {
    /** @scenario The base key is withheld from the session payload for project members */
    it("withholds the base key from the payload", async () => {
      const project = await readProject(["project:update"]);

      expect(project.apiKey).toBe("");
    });
  });

  describe("when the caller can only view the project", () => {
    /** @scenario The base key is withheld from the session payload for project members */
    it("withholds the base key from the payload", async () => {
      const project = await readProject([]);

      expect(project.apiKey).toBe("");
    });
  });

  /**
   * The LangWatchQL key is a control-plane secret withheld from everyone —
   * unlike the base key, which is gated on permission. The caller who CAN
   * manage the project is the case that matters here.
   */
  describe("when the LangWatchQL key is on the project", () => {
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
