/**
 * Unit tests for the pure-function persona resolver.
 *
 * The resolver is a small pure function; integration semantics (Prisma
 * + tRPC + getUsageStats) are exercised via the
 * personaResolver.tRPC.integration.test.ts companion. These unit tests
 * fix the matrix of input combinations to outputs without DB.
 *
 * Spec: specs/ai-gateway/governance/persona-home-resolver.feature
 */
import { describe, expect, it } from "vitest";

import {
  resolvePersonaHome,
  resolvePersonaHomeSafe,
  type PersonaResolverInput,
} from "../personaResolver.service";

const baseInput: PersonaResolverInput = {
  userLastHomePath: null,
  setupState: {
    hasPersonalVKs: false,
    hasIngestionSources: false,
    hasRecentActivity: false,
  },
  hasApplicationTraces: false,
  hasOrganizationManagePermission: false,
  isEnterprise: false,
  firstProjectSlug: null,
};

describe("resolvePersonaHome", () => {
  describe("Persona 1 — personal-only", () => {
    it("returns /me when user has personal VK and no project membership", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        setupState: { ...baseInput.setupState, hasPersonalVKs: true },
        firstProjectSlug: null,
      });
      expect(result.persona).toBe("personal_only");
      expect(result.destination).toBe("/me");
      expect(result.isOverride).toBe(false);
    });
  });

  describe("Persona 2 — mixed (personal + project)", () => {
    it("returns /me when user has both personal VK and project membership", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        setupState: { ...baseInput.setupState, hasPersonalVKs: true },
        firstProjectSlug: "team-prod",
      });
      expect(result.persona).toBe("mixed");
      expect(result.destination).toBe("/me");
    });
  });

  describe("Persona 3 — project-only LLMOps (must not regress)", () => {
    it("returns /<projectSlug>/messages when user has project but no personal VK", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        hasApplicationTraces: true,
        firstProjectSlug: "team-prod",
      });
      expect(result.persona).toBe("project_only");
      expect(result.destination).toBe("/team-prod/messages");
    });

    it("regression invariant — org admin on Enterprise but no governance state stays project_only", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        hasApplicationTraces: true,
        hasOrganizationManagePermission: true,
        isEnterprise: true,
        // Critical: hasIngestionSources=false → does NOT route to /governance
        setupState: {
          ...baseInput.setupState,
          hasIngestionSources: false,
        },
        firstProjectSlug: "team-prod",
      });
      expect(result.persona).toBe("project_only");
      expect(result.destination).toBe("/team-prod/messages");
      expect(result.destination).not.toBe("/governance");
    });
  });

  describe("Persona 4 — governance admin", () => {
    it("returns /governance when admin + Enterprise + hasIngestionSources all true", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        hasOrganizationManagePermission: true,
        isEnterprise: true,
        setupState: {
          ...baseInput.setupState,
          hasIngestionSources: true,
        },
      });
      expect(result.persona).toBe("governance_admin");
      expect(result.destination).toBe("/governance");
    });

    it("does NOT route to /governance when not Enterprise", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        hasOrganizationManagePermission: true,
        isEnterprise: false,
        setupState: {
          ...baseInput.setupState,
          hasIngestionSources: true,
        },
        firstProjectSlug: "team-prod",
      });
      expect(result.destination).not.toBe("/governance");
    });

    it("does NOT route to /governance when no manage permission", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        hasOrganizationManagePermission: false,
        isEnterprise: true,
        setupState: {
          ...baseInput.setupState,
          hasIngestionSources: true,
        },
        firstProjectSlug: "team-prod",
      });
      expect(result.destination).not.toBe("/governance");
    });
  });

  describe("user pin override", () => {
    it("returns userLastHomePath when set, regardless of persona", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        userLastHomePath: "/team-prod/messages",
        setupState: { ...baseInput.setupState, hasPersonalVKs: true },
        firstProjectSlug: "team-prod",
      });
      expect(result.destination).toBe("/team-prod/messages");
      expect(result.isOverride).toBe(true);
      // Persona is still detected even when overridden
      expect(result.persona).toBe("mixed");
    });
  });

  describe("project_only fallback when no project slug", () => {
    it("returns /me when persona is project_only but firstProjectSlug is null", () => {
      const result = resolvePersonaHome({
        ...baseInput,
        firstProjectSlug: null,
      });
      expect(result.persona).toBe("project_only");
      expect(result.destination).toBe("/me");
    });
  });
});

describe("resolvePersonaHomeSafe", () => {
  it("falls back to project_only home when given partial input", () => {
    const result = resolvePersonaHomeSafe({
      firstProjectSlug: "team-prod",
    });
    expect(result.persona).toBe("project_only");
    expect(result.destination).toBe("/team-prod/messages");
  });

  it("falls back to /me when given partial input + no project slug", () => {
    const result = resolvePersonaHomeSafe({
      firstProjectSlug: null,
    });
    expect(result.persona).toBe("project_only");
    expect(result.destination).toBe("/me");
  });

  it("preserves the LLMOps majority experience on missing signals", () => {
    const result = resolvePersonaHomeSafe({
      firstProjectSlug: "team-prod",
      // Everything else defaulted to false / null — simulates a stale
      // setupState response
    });
    expect(result.destination).toBe("/team-prod/messages");
    expect(result.destination).not.toBe("/governance");
    expect(result.destination).not.toBe("/me");
  });
});
