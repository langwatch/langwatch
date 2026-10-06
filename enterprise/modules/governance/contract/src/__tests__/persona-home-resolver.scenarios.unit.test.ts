/**
 * The persona home resolver, one case per scenario of the spec's persona matrix.
 * Spec: specs/ai-gateway/governance/persona-home-resolver.feature
 */
import { describe, expect, it } from "vitest";

import { PersonaHomeResolverService, type PersonaResolverInput } from "../persona-home.ts";

const personaHomes = PersonaHomeResolverService.create();

const baseInput: PersonaResolverInput = {
  organizationIntent: null,
  userLastHomePath: null,
  setupState: { hasPersonalVKs: false, hasIngestionSources: false, hasRecentActivity: false },
  hasApplicationTraces: false,
  hasOrganizationManagePermission: false,
  isEnterprise: false,
  hasGovernanceUi: true,
  firstProjectSlug: null,
};

const withPersonalKey = { ...baseInput.setupState, hasPersonalVKs: true };
const withIngest = { ...baseInput.setupState, hasIngestionSources: true };

describe("given the persona matrix", () => {
  describe("when a user holds a personal key and belongs to no project", () => {
    /** @scenario "Personal-only user → /me" */
    it("lands on /me as persona 1", () => {
      const result = personaHomes.resolve({ ...baseInput, setupState: withPersonalKey });

      expect(result.destination).toBe("/me");
      expect(result.persona).toBe("personal_only");
    });
  });

  describe("when a user holds a personal key and belongs to a project", () => {
    /** @scenario "User has personal VK + project membership → /me with WorkspaceSwitcher flip available" */
    it("defaults to /me as persona 2", () => {
      const result = personaHomes.resolve({
        ...baseInput,
        setupState: withPersonalKey,
        firstProjectSlug: "alex-team-prod",
      });

      expect(result.destination).toBe("/me");
      expect(result.persona).toBe("mixed");
    });
  });

  describe("when a user has no personal key, no governance and a project", () => {
    /** @scenario "Existing LLMOps customer with no governance + no personal-VK → /[project]" */
    it("lands on their first project as persona 3", () => {
      const result = personaHomes.resolve({
        ...baseInput,
        hasApplicationTraces: true,
        firstProjectSlug: "ben-team-prod",
      });

      expect(result.destination).toBe("/ben-team-prod");
      expect(result.persona).toBe("project_only");
    });
  });

  describe("when an Enterprise org admin's org has no governance state", () => {
    /** @scenario "Org admin with no governance state stays on project (does not jump to /governance)" */
    it("stays on the project home", () => {
      const result = personaHomes.resolve({
        ...baseInput,
        hasOrganizationManagePermission: true,
        isEnterprise: true,
        firstProjectSlug: "carol-team-prod",
      });

      expect(result.destination).toBe("/carol-team-prod");
      expect(result.destination).not.toBe("/governance");
    });
  });

  describe("when an Enterprise org admin's org has governance ingest", () => {
    /** @scenario "Org admin on Enterprise plan with governance ingest active → /governance" */
    it("lands on /governance as persona 4", () => {
      const result = personaHomes.resolve({
        ...baseInput,
        hasOrganizationManagePermission: true,
        isEnterprise: true,
        setupState: withIngest,
      });

      expect(result.destination).toBe("/governance");
    });
  });

  describe("when the org does not have the governance UI", () => {
    /** @scenario "Personal-VK user in a non-governance org → project home, not /me" */
    it("sends a personal-key user to the project home", () => {
      const result = personaHomes.resolve({
        ...baseInput,
        hasGovernanceUi: false,
        setupState: withPersonalKey,
        firstProjectSlug: "jane-team-prod",
      });

      expect(result.destination).toBe("/jane-team-prod");
      expect(result.destination).not.toBe("/me");
    });

    /** @scenario "Would-be governance admin in a non-governance org → project home, not /governance" */
    it("sends a would-be governance admin to the project home", () => {
      const result = personaHomes.resolve({
        ...baseInput,
        hasGovernanceUi: false,
        hasOrganizationManagePermission: true,
        isEnterprise: true,
        setupState: withIngest,
        firstProjectSlug: "carol-team-prod",
      });

      expect(result.destination).toBe("/carol-team-prod");
      expect(result.destination).not.toBe("/governance");
    });

    /** @scenario "Non-governance org member with no projects → onboarding, not the gated /me" */
    it("sends a member with no projects to onboarding", () => {
      const result = personaHomes.resolve({ ...baseInput, hasGovernanceUi: false });

      expect(result.destination).toBe("/onboarding/welcome");
      expect(result.destination).not.toBe("/me");
    });
  });

  describe("when the user pinned a home path", () => {
    /** @scenario "A user-pinned lastHomePath wins over persona detection" */
    it("returns the pin over the persona's default", () => {
      const result = personaHomes.resolve({
        ...baseInput,
        setupState: withPersonalKey,
        firstProjectSlug: "alex-team-prod",
        userLastHomePath: "/alex-team-prod",
      });

      expect(result.destination).toBe("/alex-team-prod");
      expect(result.isOverride).toBe(true);
    });
  });

  describe("when the setup state could not be read", () => {
    /** @scenario "setupState query failure → resolver falls back to default project home" */
    it("falls back to the first project without throwing", () => {
      const result = personaHomes.resolveSafe({ firstProjectSlug: "team-prod" });

      expect(result.destination).toBe("/team-prod");
    });
  });
});
