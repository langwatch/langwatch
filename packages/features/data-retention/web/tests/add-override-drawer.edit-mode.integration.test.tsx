/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AddOverrideDrawer, type RetentionEditTarget } from "../src/add-override-drawer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const available = { projects: [{ id: "proj-1" }] };

const editTarget: RetentionEditTarget = {
  scope: { scopeType: "ORGANIZATION", scopeId: "org-1" },
  scopeName: "Acme",
  retentionDays: 91,
};

// The Add-mode path renders whatever the caller's render port returns; a
// marker div is enough to prove the drawer defers scope selection to it
// instead of rendering its own picker.
const scopePicker = () => <div data-testid="scope-chip-picker" />;

function renderDrawer(
  props: Partial<React.ComponentProps<typeof AddOverrideDrawer>> = {},
) {
  return render(
    <Wrapper>
      <AddOverrideDrawer
        open
        onClose={() => {}}
        available={available}
        currentProjectId="proj-1"
        isPlatformAdmin={false}
        isEnterprise={true}
        isSaving={false}
        onSave={() => {}}
        scopePicker={scopePicker}
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
