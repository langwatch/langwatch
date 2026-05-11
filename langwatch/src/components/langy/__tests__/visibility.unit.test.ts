/**
 * Binds langy-baseline.feature § "Langy is available on every project page":
 *   - Visible on /[project]/* routes for project members
 *   - Hidden on /ops/* routes
 *   - Hidden on public-share pages
 *   - Hidden when the viewer is not a member of the project's team
 */
import { describe, expect, it } from "vitest";

import {
  isProjectRoutePath,
  shouldShowLangy,
} from "~/components/langy/visibility";

describe("shouldShowLangy", () => {
  describe("given a project route and a member of the project's team", () => {
    describe("when the page is not a public share", () => {
      it("shows Langy on the project home", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: true,
            pathname: "/[project]",
          }),
        ).toBe(true);
      });

      it("shows Langy on a nested project route", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: true,
            pathname: "/[project]/messages",
          }),
        ).toBe(true);
      });

      it("shows Langy on a deeply nested project route", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: true,
            pathname: "/[project]/experiments/workbench/[slug]",
          }),
        ).toBe(true);
      });
    });
  });

  describe("given an /ops route", () => {
    describe("when a logged-in team member visits", () => {
      it("hides Langy", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: true,
            pathname: "/ops",
          }),
        ).toBe(false);
      });

      it("hides Langy on nested /ops routes", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: true,
            pathname: "/ops/dashboards",
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a public-share page", () => {
    describe("when the publicPage flag is true", () => {
      it("hides Langy even on what would otherwise be a project route", () => {
        expect(
          shouldShowLangy({
            publicPage: true,
            userIsPartOfTeam: true,
            pathname: "/[project]/messages",
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a viewer who is not a member of the project's team", () => {
    describe("when they hit a project route", () => {
      it("hides Langy", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: false,
            pathname: "/[project]/messages",
          }),
        ).toBe(false);
      });
    });
  });

  describe("given top-level non-project routes", () => {
    describe("when on the settings landing page", () => {
      it("hides Langy", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: true,
            pathname: "/settings",
          }),
        ).toBe(false);
      });
    });

    describe("when on the auth pages", () => {
      it("hides Langy", () => {
        expect(
          shouldShowLangy({
            publicPage: false,
            userIsPartOfTeam: true,
            pathname: "/auth/signin",
          }),
        ).toBe(false);
      });
    });
  });
});

describe("isProjectRoutePath", () => {
  describe("when given a project-scoped path", () => {
    it("matches the bare /[project] template", () => {
      expect(isProjectRoutePath("/[project]")).toBe(true);
    });

    it("matches nested /[project]/* templates", () => {
      expect(isProjectRoutePath("/[project]/messages")).toBe(true);
    });
  });

  describe("when given a non-project path", () => {
    it("does not match /ops", () => {
      expect(isProjectRoutePath("/ops")).toBe(false);
    });

    it("does not match /settings", () => {
      expect(isProjectRoutePath("/settings")).toBe(false);
    });

    it("does not match an empty string", () => {
      expect(isProjectRoutePath("")).toBe(false);
    });
  });
});
