/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ScopeChipPicker pulls in data hooks we don't need here; the edit path renders
// a read-only scope readout instead, so stub the picker to a marker.
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

const editTarget: RetentionEditTarget = {
  scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
  scopeName: "Acme",
  retentionDays: 91,
};

function renderDrawer(props: Partial<React.ComponentProps<typeof AddOverrideDrawer>> = {}) {
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
        isSaving={false}
        onSave={() => {}}
        {...props}
      />
    </Wrapper>,
  );
}

describe("AddOverrideDrawer", () => {
  afterEach(cleanup);

  describe("when opened in edit mode for an existing policy", () => {
    it("titles the drawer Edit and offers Save changes", () => {
      renderDrawer({ editTarget });
      expect(screen.getByText("Edit retention policy")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    });

    it("locks the scope to a read-only readout instead of the picker", () => {
      renderDrawer({ editTarget });
      expect(screen.getByText("Acme")).toBeTruthy();
      expect(screen.getByText("organization")).toBeTruthy();
      expect(screen.queryByTestId("scope-chip-picker")).toBeNull();
    });

    it("omits the Cancel button (the X dismisses)", () => {
      renderDrawer({ editTarget });
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    });
  });

  describe("when opened in add mode", () => {
    it("titles the drawer Add and shows the scope picker and Cancel", () => {
      renderDrawer({ editTarget: null });
      expect(screen.getByText("Add retention policy")).toBeTruthy();
      expect(screen.getByTestId("scope-chip-picker")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    });
  });
});
