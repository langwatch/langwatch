import { describe, expect, it } from "vitest";
import { resolveCliAuthProjects } from "../cliAuthProjects";

describe("resolveCliAuthProjects", () => {
  const teams = [
    {
      name: "ACME",
      projects: [
        { id: "p-shared", name: "ACME Prod", slug: "acme-prod", isPersonal: false, kind: "application" },
        { id: "p-personal", name: "My Workspace", slug: "jane-personal", isPersonal: true, kind: "application" },
        { id: "p-gov", name: "Governance", slug: "internal_governance", isPersonal: false, kind: "internal_governance" },
      ],
    },
  ];

  describe("given a team with a personal, an internal-governance, and a shared project", () => {
    describe("when the CLI-auth project list is resolved", () => {
      /** @scenario the project picker omits personal and internal-governance projects */
      it("offers only the shared project", () => {
        const { projects } = resolveCliAuthProjects({ teams });

        expect(projects.map((p) => p.id)).toEqual(["p-shared"]);
        expect(projects.map((p) => p.slug)).not.toContain("jane-personal");
        expect(projects.map((p) => p.slug)).not.toContain("internal_governance");
      });
    });
  });

  describe("given several offered projects and a known last project", () => {
    const multi = [
      {
        name: "ACME",
        projects: [
          { id: "p-a", name: "A", slug: "acme-a", isPersonal: false, kind: "application" },
          { id: "p-prod", name: "Prod", slug: "acme-prod", isPersonal: false, kind: "application" },
          { id: "p-c", name: "C", slug: "acme-c", isPersonal: false, kind: "application" },
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

  describe("given a single offered project", () => {
    describe("when the default project is computed", () => {
      it("auto-selects it", () => {
        const { defaultProjectId } = resolveCliAuthProjects({ teams });
        expect(defaultProjectId).toBe("p-shared");
      });
    });
  });
});
