/**
 * @vitest-environment jsdom
 *
 * The privacy rule drawer exposes "Inherit" on every control. A new rule starts
 * every field on Inherit (so a saved-as-is rule changes nothing), an inherited
 * field shows the value it resolves to, and editing a rule shows the fields the
 * rule does not set as Inherit rather than a concrete default. Renders the real
 * drawer (no shallow, no mocked controls) and asserts via each control's value.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Disposition,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type {
  DataPrivacyRule,
  DataPrivacyScopeAvailable,
} from "~/server/data-privacy/dataPrivacyPolicy.read";
import { PrivacyRuleDrawer } from "../data-privacy";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const PROJECT_ID = "proj-1";

const available: DataPrivacyScopeAvailable = {
  organization: { id: "org-1", name: "Acme" },
  departments: [],
  teams: [{ id: "team-1", name: "Platform" }],
  projects: [{ id: PROJECT_ID, name: "Web App", teamId: "team-1" }],
};

function baseline(
  categoryDispositions: Partial<
    Record<keyof ResolvedDataPrivacy["categories"], Disposition>
  > = {},
): ResolvedDataPrivacy {
  const cat = (disposition: Disposition) => ({
    disposition,
    audience: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.input.audience },
  });
  return {
    categories: {
      input: cat(categoryDispositions.input ?? "capture"),
      output: cat(categoryDispositions.output ?? "capture"),
      system: cat(categoryDispositions.system ?? "capture"),
      tools: cat(categoryDispositions.tools ?? "capture"),
    },
    pii: { level: "essential", entities: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
  };
}

function renderDrawer({
  editingRule = null,
  effectiveTeam = baseline(),
}: {
  editingRule?: DataPrivacyRule | null;
  effectiveTeam?: ResolvedDataPrivacy;
} = {}) {
  return render(
    <PrivacyRuleDrawer
      open={true}
      editingRule={editingRule}
      onClose={vi.fn()}
      available={available}
      audienceOptions={{ groups: [] }}
      effectiveTeam={effectiveTeam}
      effectiveOrganization={baseline()}
      projectId={PROJECT_ID}
      currentTeamId="team-1"
      currentOrganizationId="org-1"
      isSaving={false}
      onSave={vi.fn()}
    />,
    { wrapper },
  );
}

/** The visible value of a content-category select, read from its trigger. */
function categoryValue(label: string): string {
  return screen.getByLabelText(label).textContent ?? "";
}

describe("PrivacyRuleDrawer inherit controls", () => {
  afterEach(cleanup);

  describe("when adding a brand-new rule", () => {
    /** @scenario A new rule starts with every setting inheriting */
    it("starts every content category, PII, and secrets on Inherit", () => {
      renderDrawer();

      expect(categoryValue("Input")).toContain("Inherit");
      expect(categoryValue("Output")).toContain("Inherit");
      expect(categoryValue("System instructions")).toContain("Inherit");
      expect(categoryValue("Tool calls")).toContain("Inherit");
      expect(categoryValue("Secrets redaction")).toContain("Inherit");

      const piiInherit = screen.getByRole("radio", { name: /Inherit/ });
      expect(piiInherit).toBeChecked();
    });
  });

  describe("when adding a rule under a parent that drops input", () => {
    /** @scenario An inherited setting shows the value it resolves to */
    it("shows the dropped value next to the inheriting input control", () => {
      renderDrawer({ effectiveTeam: baseline({ input: "drop" }) });

      expect(screen.getByText("Inherits Dropped")).toBeInTheDocument();
    });
  });

  describe("when editing a rule that only drops input", () => {
    /** @scenario Editing a rule shows unset fields as Inherit, not as a concrete default */
    it("shows input as Dropped and the rest as Inherit", () => {
      renderDrawer({
        editingRule: {
          scopeType: "PROJECT",
          scopeId: PROJECT_ID,
          personalOnly: false,
          name: "Web App",
          config: { categories: { input: { disposition: "drop" } } },
        },
      });

      expect(categoryValue("Input")).toContain("Dropped");
      expect(categoryValue("Output")).toContain("Inherit");
      expect(categoryValue("System instructions")).toContain("Inherit");
      expect(categoryValue("Tool calls")).toContain("Inherit");
      expect(categoryValue("Output")).not.toContain("Captured");
    });
  });

  describe("when editing a rule that sets strict PII", () => {
    it("shows the PII level as the explicit choice, secrets still inheriting", () => {
      renderDrawer({
        editingRule: {
          scopeType: "PROJECT",
          scopeId: PROJECT_ID,
          personalOnly: false,
          name: "Web App",
          config: { pii: { level: "strict" } },
        },
      });

      const strict = screen.getByRole("radio", { name: /Strict/ });
      expect(strict).toBeChecked();
      expect(categoryValue("Secrets redaction")).toContain("Inherit");
      const secretsSection = screen.getByLabelText("Secrets redaction");
      expect(within(secretsSection).queryByText("Captured")).toBeNull();
    });
  });
});
