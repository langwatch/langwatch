/**
 * @vitest-environment jsdom
 *
 * The Data Privacy "Effective" summary follows the scope filter: "All you can
 * see" shows the organization baseline, "This team" the team baseline, and a
 * project the full cascade. Renders the real component (no shallow) and asserts
 * the heading and the resolved values switch together with the filter.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type PiiLevel,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type { DataPrivacySnapshot } from "~/server/data-privacy/dataPrivacyPolicy.read";
import { EffectiveSummary } from "../data-privacy";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function resolvedWithPii(level: PiiLevel): ResolvedDataPrivacy {
  return {
    categories: {
      input: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.input },
      output: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.output },
      system: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.system },
      tools: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.tools },
    },
    pii: { level },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
  };
}

// Each tier resolves to a different PII level so the assertions prove the card
// reads the right one, not just the heading.
const snapshot: DataPrivacySnapshot = {
  projectId: "proj-1",
  effective: resolvedWithPii("disabled"),
  effectiveTeam: resolvedWithPii("strict"),
  effectiveOrganization: resolvedWithPii("essential"),
  rules: [],
  available: {
    organization: null,
    departments: [],
    teams: [],
    projects: [],
  },
  audienceOptions: { groups: [] },
};

describe("EffectiveSummary", () => {
  afterEach(cleanup);

  describe("when the filter is All you can see", () => {
    it("shows the organization baseline", () => {
      render(
        <EffectiveSummary
          snapshot={snapshot}
          scopeFilter={{ kind: "all" }}
          currentTeamId="team-1"
        />,
        { wrapper },
      );

      expect(
        screen.getByRole("heading", { name: "Effective for this organization" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Essential")).toBeInTheDocument();
    });
  });

  describe("when the filter is This team", () => {
    it("shows the team baseline", () => {
      render(
        <EffectiveSummary
          snapshot={snapshot}
          scopeFilter={{ kind: "team-current" }}
          currentTeamId="team-1"
        />,
        { wrapper },
      );

      expect(
        screen.getByRole("heading", { name: "Effective for this team" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Strict")).toBeInTheDocument();
    });
  });

  describe("when the filter is a specific scope that is the current team", () => {
    it("shows the team baseline", () => {
      render(
        <EffectiveSummary
          snapshot={snapshot}
          scopeFilter={{ kind: "specific", scopeType: "TEAM", scopeId: "team-1" }}
          currentTeamId="team-1"
        />,
        { wrapper },
      );

      expect(
        screen.getByRole("heading", { name: "Effective for this team" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Strict")).toBeInTheDocument();
    });
  });

  describe("when the filter is This project", () => {
    it("shows the full project cascade", () => {
      render(
        <EffectiveSummary
          snapshot={snapshot}
          scopeFilter={{ kind: "project-current" }}
          currentTeamId="team-1"
        />,
        { wrapper },
      );

      expect(
        screen.getByRole("heading", { name: "Effective for this project" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });
  });

  describe("given a personal-account project with no org or team baseline", () => {
    it("falls back to the project policy under All you can see", () => {
      render(
        <EffectiveSummary
          snapshot={{
            ...snapshot,
            effectiveTeam: null,
            effectiveOrganization: null,
          }}
          scopeFilter={{ kind: "all" }}
          currentTeamId={null}
        />,
        { wrapper },
      );

      expect(
        screen.getByRole("heading", { name: "Effective for this project" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Disabled")).toBeInTheDocument();
    });
  });
});
