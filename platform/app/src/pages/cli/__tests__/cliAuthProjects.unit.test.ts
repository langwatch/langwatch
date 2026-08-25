import { describe, expect, it } from "vitest";
import { PERSONAL_GROUP_NAME, resolveCliAuthProjects } from "../cliAuthProjects";

const JANE = "u-jane";

describe("resolveCliAuthProjects", () => {
  const teams = [
    {
      id: "t-acme",
      name: "ACME",
      projects: [
        {
          id: "p-shared",
          name: "ACME Prod",
          slug: "acme-prod",
          isPersonal: false,
          kind: "application",
        },
        {
          id: "p-gov",
          name: "Governance",
          slug: "internal_governance",
          isPersonal: false,
          kind: "internal_governance",
        },
      ],
    },
    {
      id: "t-personal",
      name: "Jane's Workspace",
      isPersonal: true,
      ownerUserId: JANE,
      projects: [
        {
          id: "p-personal",
          name: "Personal Workspace",
          slug: "jane-personal",
          isPersonal: true,
          ownerUserId: JANE,
          kind: "application",
        },
      ],
    },
  ];

  describe("given teams with a personal, an internal-governance, and a shared project", () => {
    describe("when the CLI-auth project list is resolved", () => {
      /** @scenario the project picker lists the caller's personal project explicitly and omits internal-governance projects */
      it("offers the shared project under its team and the personal project as an explicit Personal entry", () => {
        const {
          projects,
          teams: offeredTeams,
          personalProject,
        } = resolveCliAuthProjects({ teams, currentUserId: JANE });

        expect(projects.map((p) => p.id)).toEqual(["p-shared"]);
        expect(projects[0]!.teamId).toBe("t-acme");
        expect(projects.map((p) => p.slug)).not.toContain("internal_governance");
        // Personal rides its own explicit entry, never mixed into the shared
        // list, so selecting a team's project can never imply it.
        expect(projects.map((p) => p.slug)).not.toContain("jane-personal");
        expect(personalProject).toEqual({
          id: "p-personal",
          name: "Personal Workspace",
          slug: "jane-personal",
          teamId: "t-personal",
          teamName: PERSONAL_GROUP_NAME,
        });
        // Shared team headers come from offered projects; the personal group
        // is appended with its own label.
        expect(offeredTeams).toEqual([
          { id: "t-acme", name: "ACME" },
          { id: "t-personal", name: PERSONAL_GROUP_NAME },
        ]);
      });
    });
  });

  describe("given several offered projects and a known last project", () => {
    const multi = [
      {
        id: "t-acme",
        name: "ACME",
        projects: [
          {
            id: "p-a",
            name: "A",
            slug: "acme-a",
            isPersonal: false,
            kind: "application",
          },
          {
            id: "p-prod",
            name: "Prod",
            slug: "acme-prod",
            isPersonal: false,
            kind: "application",
          },
          {
            id: "p-c",
            name: "C",
            slug: "acme-c",
            isPersonal: false,
            kind: "application",
          },
        ],
      },
    ];

    describe("when the last project slug matches an offered project", () => {
      /** @scenario the project picker pre-selects the user's last project when it is offered */
      it("pre-selects the last project the user worked in", () => {
        const { defaultProjectId } = resolveCliAuthProjects({
          teams: multi,
          lastProjectSlug: "acme-prod",
        });

        expect(defaultProjectId).toBe("p-prod");
      });
    });

    describe("when the last project slug is not among the offered projects", () => {
      it("falls back to no default", () => {
        const { defaultProjectId } = resolveCliAuthProjects({
          teams: multi,
          lastProjectSlug: "jane-personal",
        });

        expect(defaultProjectId).toBeNull();
      });
    });
  });

  describe("given a single offered shared project", () => {
    describe("when the default project is computed", () => {
      it("auto-selects it, not the personal project", () => {
        const { defaultProjectId } = resolveCliAuthProjects({
          teams,
          currentUserId: JANE,
        });
        expect(defaultProjectId).toBe("p-shared");
      });
    });
  });

  describe("given an organization with no shared projects at all", () => {
    const personalOnly = [
      {
        id: "t-personal",
        name: "Jane's Workspace",
        isPersonal: true,
        ownerUserId: JANE,
        projects: [
          {
            id: "p-personal",
            name: "Personal Workspace",
            slug: "jane-personal",
            isPersonal: true,
            ownerUserId: JANE,
            kind: "application",
          },
        ],
      },
      // An empty shared team (fresh coding-usage signup shape).
      { id: "t-empty", name: "Team", projects: [] },
    ];

    describe("when the default project is computed", () => {
      /** @scenario a user with no shared projects gets their personal project preselected */
      it("preselects the personal project so the user is never dead-ended", () => {
        const { projects, personalProject, defaultProjectId } = resolveCliAuthProjects({
          teams: personalOnly,
          currentUserId: JANE,
        });

        expect(projects).toEqual([]);
        expect(personalProject?.id).toBe("p-personal");
        expect(defaultProjectId).toBe("p-personal");
      });
    });

    describe("when there is no personal project either", () => {
      it("returns no default and no personal entry", () => {
        const { personalProject, defaultProjectId } = resolveCliAuthProjects({
          teams: [{ id: "t-empty", name: "Team", projects: [] }],
          currentUserId: JANE,
        });

        expect(personalProject).toBeNull();
        expect(defaultProjectId).toBeNull();
      });
    });
  });

  describe("given an org admin who can see other members' personal teams", () => {
    // `organization.getAll` retains EVERY team for an admin, including other
    // members' personal workspaces. The picker must offer only the admin's own.
    const adminView = [
      {
        id: "t-bob-personal",
        name: "Bob's Workspace",
        isPersonal: true,
        ownerUserId: "u-bob",
        projects: [
          {
            id: "p-bob",
            name: "Bob Personal",
            slug: "bob-personal",
            isPersonal: true,
            ownerUserId: "u-bob",
            kind: "application",
          },
        ],
      },
      {
        id: "t-jane-personal",
        name: "Jane's Workspace",
        isPersonal: true,
        ownerUserId: JANE,
        projects: [
          {
            id: "p-jane",
            name: "Jane Personal",
            slug: "jane-personal",
            isPersonal: true,
            ownerUserId: JANE,
            kind: "application",
          },
        ],
      },
    ];

    describe("with no shared projects in the org", () => {
      /** @scenario an org admin is offered only their OWN personal workspace, never a colleague's */
      it("offers and preselects only the caller's own personal workspace", () => {
        const { personalProject, defaultProjectId } = resolveCliAuthProjects({
          teams: adminView,
          currentUserId: JANE,
        });

        expect(personalProject?.id).toBe("p-jane");
        expect(personalProject?.slug).toBe("jane-personal");
        expect(defaultProjectId).toBe("p-jane");
      });
    });

    describe("when the caller id is unknown", () => {
      /** @scenario no caller id yields no personal entry */
      it("offers no personal entry rather than guessing a workspace", () => {
        const { personalProject, defaultProjectId } = resolveCliAuthProjects({
          teams: adminView,
        });

        expect(personalProject).toBeNull();
        expect(defaultProjectId).toBeNull();
      });
    });
  });

  describe("given multiple shared projects and a personal project", () => {
    const mixed = [
      {
        id: "t-acme",
        name: "ACME",
        projects: [
          {
            id: "p-a",
            name: "A",
            slug: "acme-a",
            isPersonal: false,
            kind: "application",
          },
          {
            id: "p-b",
            name: "B",
            slug: "acme-b",
            isPersonal: false,
            kind: "application",
          },
        ],
      },
      {
        id: "t-personal",
        name: "Jane's Workspace",
        isPersonal: true,
        ownerUserId: JANE,
        projects: [
          {
            id: "p-personal",
            name: "Personal Workspace",
            slug: "jane-personal",
            isPersonal: true,
            ownerUserId: JANE,
            kind: "application",
          },
        ],
      },
    ];

    describe("when the default project is computed with no last project", () => {
      it("does not silently default to personal while shared projects exist", () => {
        const { defaultProjectId } = resolveCliAuthProjects({
          teams: mixed,
          currentUserId: JANE,
        });
        expect(defaultProjectId).toBeNull();
      });
    });
  });
});
