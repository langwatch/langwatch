/**
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddOverrideDrawer, type RetentionEditTarget } from "../add-override-drawer.tsx";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const available = { projects: [{ id: "proj-1" }] };

const scopePicker = () => <div data-testid="scope-chip-picker" />;

function renderDrawer(props: Partial<React.ComponentProps<typeof AddOverrideDrawer>>) {
  return render(
    <Wrapper>
      <AddOverrideDrawer
        open
        onClose={() => {}}
        available={available}
        currentProjectId="proj-1"
        isPlatformAdmin={false}
        isEnterprise={false}
        isSaving={false}
        onSave={() => {}}
        scopePicker={scopePicker}
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

  describe("when a new policy is created", () => {
    /** @scenario "Saving a policy from the editor never rewrites stored data by itself" */
    it("hands over only the scopes and the period, with no switch to rewrite stored data", () => {
      const onSave = vi.fn();
      // Add mode defaults the scope to the current project and the retention to
      // the first plan preset, so Create is enabled without further input.
      renderDrawer({ isEnterprise: true, onSave });
      expect(screen.queryByText("Apply this change to existing data")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(Object.keys(onSave.mock.calls[0]?.[0] ?? {}).toSorted()).toEqual([
        "retentionDays",
        "scopes",
      ]);
    });
  });

  describe("when a paid org edits a grandfathered out-of-menu value", () => {
    const legacyTarget: RetentionEditTarget = {
      scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
      scopeName: "Acme",
      retentionDays: 1827, // enterprise-only value, not on the paid menu
    };

    /** @scenario "A grandfathered value is shown but never silently changed" */
    it("surfaces it as read-only 'current (legacy)' and refuses to save it until changed", () => {
      const onSave = vi.fn();
      renderDrawer({ isEnterprise: false, editTarget: legacyTarget, onSave });
      // The label shows in both the selected-value readout and the option list,
      // so assert at least one occurrence rather than a unique match.
      expect(screen.getAllByText("Current: 1827 days (legacy)").length).toBeGreaterThan(0);
      // Grandfathering: never coerce or silently shorten. Save is clickable, says why it
      // cannot save the read-only legacy value, and never reaches onSave.
      const save = screen.getByRole("button", { name: "Save changes" });
      expect((save as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(save);

      expect(onSave).not.toHaveBeenCalled();
      expect(screen.getByText(/isn't available on your plan/)).toBeTruthy();
    });
  });
});
