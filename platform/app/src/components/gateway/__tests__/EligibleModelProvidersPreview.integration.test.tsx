/**
 * @vitest-environment jsdom
 *
 * The "Eligible model providers" panel in the virtual-key drawers is the
 * only place a user sees, before issuing a key, what that key will be able
 * to reach. Three failure modes it must not have:
 *
 *   1. Advertising a provider the gateway would refuse to dispatch to. An
 *      admin who switches a provider off (or removes it) has withdrawn a
 *      credential; a key that still lists it as routable is a governance
 *      hole, not a stale count.
 *   2. Attributing an inherited provider to the key's own scope. An
 *      organization-wide provider reaching a project key comes FROM the
 *      organization, and must read that way.
 *   3. Printing the raw scope enum instead of the shared scope chip every
 *      other settings surface uses.
 *
 * Renders the real component tree (real ProviderScopeChips, real Chakra) with
 * no mocks, so a regression in any of the three shows up here.
 *
 * Spec: specs/ai-gateway/governance/vk-scope-inheritance.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  EligibleModelProvidersPreview,
  EligibleModelProvidersSummary,
} from "../EligibleModelProvidersPreview";
import type { OrgModelProvider } from "../eligibleModelProviders";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const ORG_ID = "org-acme";
const TEAM_ID = "team-platform";
const PROJECT_ID = "project-doc-chat";

const availableTeams = [{ id: TEAM_ID, name: "developers" }];
const availableProjects = [
  { id: PROJECT_ID, name: "Doc Chat · developers", teamId: TEAM_ID },
];
const projectScope = [{ scopeType: "PROJECT" as const, scopeId: PROJECT_ID }];

const orgProvider: OrgModelProvider = {
  id: "mp-org-anthropic",
  name: "Central Anthropic",
  provider: "anthropic",
  enabled: true,
  scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
  models: ["claude-sonnet-4-5"],
};

const projectProvider: OrgModelProvider = {
  id: "mp-project-openai",
  name: "Doc Chat OpenAI",
  provider: "openai",
  enabled: true,
  scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
  models: ["gpt-5-mini"],
};

const renderPreview = (providers: OrgModelProvider[]) =>
  render(
    <EligibleModelProvidersPreview
      scopes={projectScope}
      organizationId={ORG_ID}
      organizationName="ACME"
      availableTeams={availableTeams}
      availableProjects={availableProjects}
      providers={providers}
    />,
    { wrapper: Wrapper },
  );

const renderSummary = (providers: OrgModelProvider[]) =>
  render(
    <EligibleModelProvidersSummary
      scopes={projectScope}
      organizationId={ORG_ID}
      organizationName="ACME"
      availableTeams={availableTeams}
      availableProjects={availableProjects}
      providers={providers}
    />,
    { wrapper: Wrapper },
  );

describe("given the eligible model providers panel at a project scope", () => {
  afterEach(() => cleanup());

  describe("when an organization-wide provider is inherited by the project", () => {
    /** @scenario An org-scoped provider inherited into a project is attributed to the organization */
    it("attributes the row to the organization, not the key's project", () => {
      renderPreview([orgProvider]);

      expect(screen.getByText("Central Anthropic")).toBeTruthy();
      expect(screen.getByText("ACME")).toBeTruthy();
      expect(screen.queryByText("Doc Chat")).toBeNull();
    });

    /** @scenario Scope attribution uses the same scope chip as every other settings surface */
    it("renders the scope with the shared chip instead of the raw scope type", () => {
      const { container } = renderPreview([orgProvider]);

      expect(container.textContent).not.toContain("ORGANIZATION");
      expect(container.textContent).not.toContain("PROJECT");
      expect(container.textContent).not.toContain("via ");
    });
  });

  describe("when a provider is scoped to the project itself", () => {
    it("attributes the row to that project", () => {
      renderPreview([projectProvider]);

      expect(screen.getByText("Doc Chat")).toBeTruthy();
    });
  });

  describe("when providers at different tiers are both in scope", () => {
    /** @scenario An org-scoped provider inherited into a project is attributed to the organization */
    it("gives each row its own defining scope", () => {
      renderPreview([orgProvider, projectProvider]);

      expect(screen.getByText("ACME")).toBeTruthy();
      expect(screen.getByText("Doc Chat")).toBeTruthy();
    });
  });

  describe("when an admin turned a provider off", () => {
    /** @scenario A provider an admin turned off is not offered to a new key */
    it("does not offer it to the key", () => {
      renderPreview([orgProvider, { ...projectProvider, enabled: false }]);

      expect(screen.getByText("Central Anthropic")).toBeTruthy();
      expect(screen.queryByText("Doc Chat OpenAI")).toBeNull();
    });
  });

  describe("when a provider was removed and only its withdrawn row remains", () => {
    /** @scenario A provider an admin removed is not offered to a new key */
    it("does not offer it to the key", () => {
      renderPreview([
        orgProvider,
        { ...projectProvider, disabledAt: new Date("2026-07-01T00:00:00Z") },
      ]);

      expect(screen.getByText("Central Anthropic")).toBeTruthy();
      expect(screen.queryByText("Doc Chat OpenAI")).toBeNull();
    });
  });

  describe("when every in-scope provider has been withdrawn", () => {
    it("falls back to the empty state instead of listing them", () => {
      const { container } = renderPreview([
        { ...orgProvider, enabled: false },
        { ...projectProvider, disabledAt: new Date("2026-07-01T00:00:00Z") },
      ]);

      expect(container.textContent).toContain("No model providers visible at this scope");
    });
  });

  describe("when one provider is attached at several scopes the key reaches", () => {
    /** @scenario The same provider is never listed twice */
    it("lists it once, attributed to the broadest scope", () => {
      renderPreview([
        {
          ...orgProvider,
          scopes: [
            { scopeType: "ORGANIZATION", scopeId: ORG_ID },
            { scopeType: "TEAM", scopeId: TEAM_ID },
            { scopeType: "PROJECT", scopeId: PROJECT_ID },
          ],
        },
      ]);

      expect(screen.getAllByText("Central Anthropic")).toHaveLength(1);
      expect(screen.getByText("ACME")).toBeTruthy();
    });
  });
});

describe("given the eligible model providers summary at a project scope", () => {
  afterEach(() => cleanup());

  describe("when two providers are routable", () => {
    /** @scenario Picking a scope renders the resolved provider set inline */
    it("names the scope the way the user picked it, never as a scope type", () => {
      const { container } = renderSummary([orgProvider, projectProvider]);

      expect(container.textContent).toContain("Doc Chat");
      expect(container.textContent).not.toContain("PROJECT:");
      expect(container.textContent).not.toContain("ORGANIZATION");
    });

    it("counts the providers and their models", () => {
      const { container } = renderSummary([orgProvider, projectProvider]);

      expect(container.textContent).toContain("2 providers");
      expect(container.textContent).toContain("2 models");
    });

    // Enforces the copy rule "never expose internal technical details" from
    // dev/docs/best_practices/copywriting.md. That is a doc, not a feature
    // file, so this test carries no spec binding: the parity scanner only
    // resolves titles that exist as scenarios under specs/.
    it("stays clear of internal routing jargon", () => {
      const { container } = renderSummary([orgProvider, projectProvider]);

      expect(container.textContent).not.toContain("fall back");
      expect(container.textContent).not.toContain("VK");
    });
  });

  describe("when a withdrawn provider is in scope", () => {
    /** @scenario A provider an admin turned off is not offered to a new key */
    it("leaves it out of the count", () => {
      const { container } = renderSummary([
        orgProvider,
        { ...projectProvider, enabled: false },
      ]);

      expect(container.textContent).toContain("1 provider");
      expect(container.textContent).not.toContain("2 providers");
    });
  });
});
