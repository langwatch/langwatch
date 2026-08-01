import { describe, expect, it } from "vitest";
import { resolveWelcomeRedirect } from "./welcome-redirect";

/**
 * ADR-038 v6: the welcome screen's redirect decision. An intent-set org is
 * onboarded, period — re-showing the create-org form would mint a duplicate
 * organization. Personal workspaces never count as projects.
 *
 * Spec: specs/features/onboarding/intent-fork.feature
 */
describe("resolveWelcomeRedirect", () => {
  const org = (
    primaryIntent: string | null,
    teams: { isPersonal: boolean; projects: { slug: string }[] }[],
  ) => ({ primaryIntent, teams });

  describe("when the user has no organization yet", () => {
    it("onboards", () => {
      expect(
        resolveWelcomeRedirect({
          organizations: [],
          currentProjectSlug: null,
        }),
      ).toEqual({ kind: "onboard" });
    });
  });

  describe("when a governance org exists without a project", () => {
    it("sends the user home instead of re-onboarding (duplicate-org guard)", () => {
      expect(
        resolveWelcomeRedirect({
          organizations: [org("AGENT_GOVERNANCE", [])],
          currentProjectSlug: null,
        }),
      ).toEqual({ kind: "home" });
    });
  });

  describe("when a project-less LLMOps org exists (flip + postponed project)", () => {
    it("sends the user home instead of re-onboarding — any intent-set org is onboarded", () => {
      expect(
        resolveWelcomeRedirect({
          organizations: [
            org("LLM_OPS", [{ isPersonal: false, projects: [] }]),
          ],
          currentProjectSlug: null,
        }),
      ).toEqual({ kind: "home" });
    });
  });

  describe("when only a personal workspace exists", () => {
    it("does not count it as a project and never targets its slug", () => {
      const result = resolveWelcomeRedirect({
        organizations: [
          org("AGENT_GOVERNANCE", [
            { isPersonal: true, projects: [{ slug: "personal-abc" }] },
          ]),
        ],
        currentProjectSlug: null,
      });
      expect(result).toEqual({ kind: "home" });
    });
  });

  describe("when a legacy org has a shared project", () => {
    it("redirects to that project", () => {
      expect(
        resolveWelcomeRedirect({
          organizations: [
            org(null, [
              { isPersonal: true, projects: [{ slug: "personal-abc" }] },
              { isPersonal: false, projects: [{ slug: "acme-prod" }] },
            ]),
          ],
          currentProjectSlug: null,
        }),
      ).toEqual({ kind: "project", slug: "acme-prod" });
    });

    it("prefers the currently selected project slug", () => {
      expect(
        resolveWelcomeRedirect({
          organizations: [
            org(null, [{ isPersonal: false, projects: [{ slug: "first" }] }]),
          ],
          currentProjectSlug: "selected",
        }),
      ).toEqual({ kind: "project", slug: "selected" });
    });
  });

  describe("when a legacy org has no project at all", () => {
    it("onboards, exactly as before the fork", () => {
      expect(
        resolveWelcomeRedirect({
          organizations: [org(null, [{ isPersonal: false, projects: [] }])],
          currentProjectSlug: null,
        }),
      ).toEqual({ kind: "onboard" });
    });
  });
});
