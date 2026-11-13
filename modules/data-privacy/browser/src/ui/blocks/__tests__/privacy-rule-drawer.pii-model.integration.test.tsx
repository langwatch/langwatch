/**
 * @vitest-environment jsdom
 * The drawer's PII level with release_pii_redaction_model_enabled: what it runs and stores.
 * Spec: modules/data-privacy/specs/pii-redaction-level-picker.feature
 */
import {
  type DataPrivacyScopeAvailable,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivacyRuleDrawer } from "../privacy-rule-drawer.tsx";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const available: DataPrivacyScopeAvailable = {
  organization: { id: "org-1", name: "Acme" },
  departments: [],
  teams: [{ id: "team-1", name: "Platform" }],
  projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
};

const baseline: ResolvedDataPrivacy = {
  ...PLATFORM_DEFAULT_DATA_PRIVACY,
  pii: { level: "essential", entities: [], exceptPatterns: [] },
};

function renderDrawer({ piiRedactionModelOffered }: { piiRedactionModelOffered: boolean }) {
  return render(
    <PrivacyRuleDrawer
      open={true}
      editingRule={null}
      onClose={vi.fn()}
      available={available}
      audienceOptions={{ groups: [] }}
      effectiveTeam={baseline}
      effectiveOrganization={baseline}
      projectId="proj-1"
      isSaving={false}
      piiRedactionModelOffer={piiRedactionModelOffered ? { kind: "model", free: false } : null}
      onSave={vi.fn()}
      scopePicker={() => <div data-testid="scope-picker" />}
    />,
    { wrapper },
  );
}

async function choosePiiLevel(name: "Essential" | "Strict") {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("PII redaction"));
  await user.click(await screen.findByRole("option", { name: new RegExp(`^${name}`) }));
}

describe("PrivacyRuleDrawer PII level with the PII redaction model", () => {
  afterEach(cleanup);

  describe("when the flag is on and the rule is set to Strict, then Essential", () => {
    /** @scenario The rule drawer shows the rule's own level and its example */
    it("names the model with its price and shows each level's example", async () => {
      renderDrawer({ piiRedactionModelOffered: true });

      await choosePiiLevel("Strict");

      expect(await screen.findByText("LangWatch PII Redaction Model")).toBeInTheDocument();
      expect(screen.getByTestId("pii-redaction-model-price").textContent).toContain("$0.50");
      expect(screen.getByTestId("pii-example-strict").textContent).toContain("[NAME]");

      await choosePiiLevel("Essential");

      expect(await screen.findByText("Standard detection · included")).toBeInTheDocument();
      expect(screen.queryByText("LangWatch PII Redaction Model")).toBeNull();
      expect(screen.getByTestId("pii-example-essential").textContent).toContain("Daniel Okafor");
      expect(screen.queryByTestId("pii-example-strict")).toBeNull();
    });
  });

  describe("when the flag is on and the rule inherits Essential", () => {
    it("shows the inherited level's example", () => {
      renderDrawer({ piiRedactionModelOffered: true });

      expect(screen.getByTestId("pii-example-essential")).toBeInTheDocument();
    });
  });

  describe("when the flag is off and the rule is set to Strict", () => {
    /** @scenario Without the flag the rule drawer shows no model, price or example */
    it("names no model, no price and no example", async () => {
      renderDrawer({ piiRedactionModelOffered: false });

      await choosePiiLevel("Strict");

      expect(screen.queryByText("LangWatch PII Redaction Model")).toBeNull();
      expect(screen.queryByTestId("pii-redaction-model-price")).toBeNull();
      expect(screen.queryByTestId("pii-example-strict")).toBeNull();
      expect(screen.queryByText(/synthetic/)).toBeNull();
    });
  });
});
