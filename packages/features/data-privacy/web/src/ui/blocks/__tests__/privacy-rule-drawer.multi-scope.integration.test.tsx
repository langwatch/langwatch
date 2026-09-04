/**
 * @vitest-environment jsdom
 *
 * A privacy rule drawer save can target several scopes at once — the caller
 * (the data-privacy screen) writes one rule per selected scope, but the
 * drawer's own contract is what carries every scope the picker holds through
 * to a single `onSave` call.
 *
 * Spec: specs/data-privacy/policy-configuration.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DataPrivacyScopeAvailable,
  PLATFORM_DEFAULT_DATA_PRIVACY,
} from "@langwatch/data-privacy-contract";
import { PrivacyRuleDrawer } from "../privacy-rule-drawer";
import type { PrivacyScopeEntry } from "../../../model/data-privacy-rule-config";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const PROJECT_ID = "web-app";

const available: DataPrivacyScopeAvailable = {
  organization: { id: "org-1", name: "Acme" },
  departments: [],
  teams: [{ id: "team-1", name: "Platform" }],
  projects: [
    { id: "web-app", name: "Web App", teamId: "team-1" },
    { id: "mobile-app", name: "Mobile App", teamId: "team-1" },
  ],
};

const TWO_PROJECT_SCOPES: PrivacyScopeEntry[] = [
  { scopeType: "PROJECT", scopeId: "web-app" },
  { scopeType: "PROJECT", scopeId: "mobile-app" },
];

/**
 * Stands in for the real chip picker: a button that picks both projects at
 * once, the way clicking two chips would. Firing from a click (not on mount)
 * matters — the drawer's own open effect seeds `scopes` to a single default
 * project on mount, so a mount-time onChange would race it.
 */
function TwoScopePicker({
  onChange,
}: {
  value: PrivacyScopeEntry[];
  onChange: (value: PrivacyScopeEntry[]) => void;
}) {
  return (
    <button type="button" onClick={() => onChange(TWO_PROJECT_SCOPES)}>
      Pick web-app and mobile-app
    </button>
  );
}

function renderDrawer(onSave: (scopes: PrivacyScopeEntry[], config: unknown) => void) {
  return render(
    <PrivacyRuleDrawer
      open={true}
      editingRule={null}
      onClose={vi.fn()}
      available={available}
      audienceOptions={{ groups: [] }}
      effectiveTeam={PLATFORM_DEFAULT_DATA_PRIVACY}
      effectiveOrganization={PLATFORM_DEFAULT_DATA_PRIVACY}
      projectId={PROJECT_ID}
      isSaving={false}
      onSave={onSave}
      scopePicker={(props) => <TwoScopePicker {...props} />}
    />,
    { wrapper },
  );
}

afterEach(cleanup);

describe("saving a privacy rule at several scopes", () => {
  describe("when two scopes are picked before saving", () => {
    /** @scenario One save can target several scopes at once */
    it("hands both scopes to onSave in a single call", async () => {
      const onSave = vi.fn();
      renderDrawer(onSave);
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Pick web-app and mobile-app" }));
      // Any concrete choice away from Inherit is enough to enable Save.
      await user.click(screen.getByRole("radio", { name: /^Strict/ }));
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(onSave).toHaveBeenCalledTimes(1);
      const [savedScopes] = onSave.mock.calls[0] as [PrivacyScopeEntry[], unknown];
      expect(savedScopes).toEqual(TWO_PROJECT_SCOPES);
    });
  });
});
