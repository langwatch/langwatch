/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/settings/ScopeChipPicker", () => ({
  ScopeChipPicker: () => <div data-testid="scope-chip-picker" />,
}));

import {
  AddOverrideDrawer,
  type RetentionEditTarget,
} from "../AddOverrideDrawer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const available = {
  organization: { id: "org-1", name: "Acme" },
  teams: [],
  projects: [{ id: "proj-1", name: "Web App", teamId: "team-1" }],
};

function renderDrawer(
  props: Partial<React.ComponentProps<typeof AddOverrideDrawer>>,
) {
  return render(
    <Wrapper>
      <AddOverrideDrawer
        open
        onClose={() => {}}
        available={available}
        currentOrganizationId="org-1"
        currentTeamId={undefined}
        currentProjectId="proj-1"
        isPlatformAdmin={false}
        isEnterprise={false}
        isSaving={false}
        onSave={() => {}}
        {...props}
      />
    </Wrapper>,
  );
}

// Menu-content gating is covered exhaustively by the pure buildRetentionMenuItems
// unit test; these cases lock the drawer-level behaviors that only exist once
// rendered (default switch state, grandfather Save-guard).
describe("AddOverrideDrawer plan-gated behavior", () => {
  afterEach(cleanup);

  describe("the apply-to-existing toggle", () => {
    it("defaults OFF, so saving a new policy never triggers a rewrite unasked", () => {
      const onSave = vi.fn();
      // Add mode defaults the scope to the current project and the retention to
      // the first plan preset, so Create is enabled without further input.
      renderDrawer({ isEnterprise: true, onSave });

      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({
        applyToExisting: false,
      });
    });
  });

  describe("when a paid org edits a grandfathered out-of-menu value", () => {
    const legacyTarget: RetentionEditTarget = {
      scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
      scopeName: "Acme",
      retentionDays: 371, // enterprise-only value, not on the paid menu
    };

    it("surfaces it as read-only 'current (legacy)' and disables Save until changed", () => {
      renderDrawer({ isEnterprise: false, editTarget: legacyTarget });
      // The label shows in both the selected-value readout and the option list,
      // so assert at least one occurrence rather than a unique match.
      expect(
        screen.getAllByText("Current: 371 days (legacy)").length,
      ).toBeGreaterThan(0);
      // Grandfathering: never coerce or silently shorten — Save stays disabled
      // while the read-only legacy value is selected.
      const save = screen.getByRole("button", {
        name: "Save changes",
      }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
    });
  });
});
