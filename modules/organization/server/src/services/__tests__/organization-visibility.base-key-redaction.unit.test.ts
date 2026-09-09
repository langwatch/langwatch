/**
 * @vitest-environment node
 *
 * @see specs/api-keys/project-key-read-access.feature
 *
 * The project base key travels inside the `organization.getAll` payload the
 * shell loads on every page, so gating the endpoints that return it is only
 * half the job: what the session already holds has to be gated too.
 *
 * The rule used to live in the tRPC transport, where nothing could reach it
 * without a router. It is the visibility service's now, and this exercises it
 * over a stubbed organization read and the two permission questions that
 * decide who gets the key.
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
 * Permits `project:update` exactly when the case under test says so, and never
 * permits `organization:manage`: the base key is gated on the project, and a
 * manage answer would mask which question decided it.
 */
function testPermissions(canUpdateProject: boolean): AuthzApi {
  return {
    hasPermission: vi.fn(
      async (check: { permission: string }) =>
        check.permission === "project:update" && canUpdateProject,
    ),
    listBindingsForSynthesis: vi.fn(async () => []),
  } as unknown as AuthzApi;
}

function visibility(canUpdateProject: boolean) {
  return OrganizationVisibilityService.create({
    reader: {
      getAllForUser: vi.fn(async () => organizationPayload()),
      tryGetOrganizationWithMembers: vi.fn(async () => null),
      tryGetMemberById: vi.fn(async () => null),
    },
    permissions: testPermissions(canUpdateProject),
    secrets: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    demoProject: { userId: "", projectId: "" },
  });
}

/** The only project in the only team of the only organization. */
async function readProject(canUpdateProject: boolean) {
  const organizations = await visibility(canUpdateProject).listVisible({ isDemo: false }, CALLER);
  const project = organizations[0]?.teams[0]?.projects[0];

  if (!project) throw new Error("the redaction dropped the project it was meant to redact");

  return project;
}

describe("given the base key in the organizations payload", () => {
  describe("when the caller can change the project", () => {
    /** @scenario The base key stays in the session payload for those who can change the project */
    it("includes the base key in the payload", async () => {
      const project = await readProject(true);

      expect(project.apiKey).toBe(BASE_API_KEY);
    });
  });

  describe("when the caller can only view the project", () => {
    /** @scenario The base key is withheld from the session payload for read-only roles */
    it("withholds the base key from the payload", async () => {
      const project = await readProject(false);

      expect(project.apiKey).toBe("");
    });
  });

  /**
   * The LangWatchQL key is a control-plane secret, not a credential any client
   * surface renders: it is withheld from everyone, unlike the base key, which
   * is gated on permission. The caller who CAN change the project is the case
   * that matters - a permission-gated redaction would hand it to them.
   */
  describe("when the LangWatchQL key is on the project", () => {
    it.each([
      ["a caller who can change the project", true],
      ["a caller who can only view the project", false],
    ])("withholds it from the payload for %s", async (_label, canUpdateProject) => {
      const project = await readProject(canUpdateProject);

      expect(project.lwqlKey).toBe("");
    });
  });
});
