import { describe, expect, it } from "vitest";

import { findPersonalProject } from "../personalProject";

/**
 * A personal workspace is created per organization
 * (PersonalWorkspaceService.ensure takes an organizationId), so a user who
 * belongs to several organizations owns several personal projects. The
 * resolution therefore has to name which organization it is asking about:
 * without one it returned whichever personal team came first in an unordered
 * organization list, and the Me sidebar linked to another organization's
 * personal workspace.
 */

const USER = "user-1";

const orgWithPersonalProject = ({
  orgId,
  project,
  ownerUserId = USER,
}: {
  orgId: string;
  project: { id: string; slug: string };
  ownerUserId?: string;
}) => ({
  id: orgId,
  teams: [
    {
      isPersonal: true,
      ownerUserId,
      projects: [project],
    },
  ],
});

const FIRST_ORG = orgWithPersonalProject({
  orgId: "org-first",
  project: { id: "proj-first", slug: "personal-first" },
});
const SECOND_ORG = orgWithPersonalProject({
  orgId: "org-second",
  project: { id: "proj-second", slug: "personal-second" },
});

describe("findPersonalProject", () => {
  describe("given the user owns a personal project in more than one organization", () => {
    const organizations = [FIRST_ORG, SECOND_ORG];

    it("resolves the personal project of the organization asked about", () => {
      expect(
        findPersonalProject({
          organizations,
          userId: USER,
          organizationId: "org-second",
        }),
      ).toEqual({ id: "proj-second", slug: "personal-second" });
    });

    it("still resolves the first organization when that is the one asked about", () => {
      expect(
        findPersonalProject({
          organizations,
          userId: USER,
          organizationId: "org-first",
        }),
      ).toEqual({ id: "proj-first", slug: "personal-first" });
    });
  });

  describe("given the organization asked about holds no personal project", () => {
    it("resolves nothing rather than another organization's", () => {
      const sharedOnly = {
        id: "org-shared",
        teams: [
          {
            isPersonal: false,
            ownerUserId: null,
            projects: [{ id: "proj-shared", slug: "shared" }],
          },
        ],
      };

      expect(
        findPersonalProject({
          organizations: [FIRST_ORG, sharedOnly],
          userId: USER,
          organizationId: "org-shared",
        }),
      ).toBeNull();
    });
  });

  describe("given no organization has been resolved yet", () => {
    it("resolves nothing", () => {
      expect(
        findPersonalProject({
          organizations: [FIRST_ORG],
          userId: USER,
          organizationId: undefined,
        }),
      ).toBeNull();
    });
  });

  describe("given the organization asked about holds somebody else's personal project", () => {
    it("resolves nothing", () => {
      const someoneElses = orgWithPersonalProject({
        orgId: "org-first",
        project: { id: "proj-theirs", slug: "personal-theirs" },
        ownerUserId: "user-2",
      });

      expect(
        findPersonalProject({
          organizations: [someoneElses],
          userId: USER,
          organizationId: "org-first",
        }),
      ).toBeNull();
    });
  });

  describe("given no user has been resolved yet", () => {
    it("resolves nothing", () => {
      expect(
        findPersonalProject({
          organizations: [FIRST_ORG],
          userId: null,
          organizationId: "org-first",
        }),
      ).toBeNull();
    });
  });

  describe("given the organizations have not loaded yet", () => {
    it("resolves nothing", () => {
      expect(
        findPersonalProject({
          organizations: undefined,
          userId: USER,
          organizationId: "org-first",
        }),
      ).toBeNull();
    });
  });
});
