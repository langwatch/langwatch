// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Input } from "@chakra-ui/react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsField } from "../src/components/forms/settings-field.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

describe("SettingsField", () => {
  describe("given a label, a hint and an error", () => {
    it("labels the control, describes it and marks it invalid", () => {
      renderWithDesignSystem(
        <SettingsField label="Name" hint="Shown on invoices." error="Enter a name.">
          <Input />
        </SettingsField>,
      );

      const input = screen.getByRole("textbox", { name: "Name" });
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Shown on invoices.")).toBeInTheDocument();
      expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    });
  });

  describe("given no layout prop", () => {
    it("reads inline on a page and stacked inside a drawer", () => {
      renderWithDesignSystem(
        <>
          <SettingsField label="On the page" data-testid="page-field">
            <Input />
          </SettingsField>
          <Drawer.Root open>
            <Drawer.Content>
              <SettingsField label="In the drawer" data-testid="drawer-field">
                <Input />
              </SettingsField>
            </Drawer.Content>
          </Drawer.Root>
        </>,
      );

      expect(screen.getByTestId("page-field")).toHaveAttribute("data-layout", "inline");
      expect(screen.getByTestId("drawer-field")).toHaveAttribute("data-layout", "stacked");
    });
  });

  describe("given no error", () => {
    it("leaves the control valid", () => {
      renderWithDesignSystem(
        <SettingsField label="Name" layout="stacked">
          <Input />
        </SettingsField>,
      );

      expect(screen.getByRole("textbox", { name: "Name" })).not.toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
  });
});
