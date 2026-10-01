// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsSection } from "../src/components/settings-section.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("SettingsSection", () => {
  describe("given a title, a hint, an action and a body", () => {
    it("names the section as a heading and shows the rest", () => {
      renderWithDesignSystem(
        <SettingsSection
          icon={<svg data-testid="icon" />}
          title="Your details"
          hint="How you are shown."
          actions={<button type="button">Edit</button>}
        >
          <p>Body</p>
        </SettingsSection>,
      );

      expect(screen.getByRole("heading", { name: "Your details" })).toBeTruthy();
      expect(screen.getByTestId("icon")).toBeTruthy();
      expect(screen.getByText("How you are shown.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
      expect(screen.getByText("Body")).toBeTruthy();
    });
  });

  describe("given only a title", () => {
    it("renders no hint and no action", () => {
      renderWithDesignSystem(<SettingsSection icon={null} title="Sessions" />);

      expect(screen.getByRole("heading", { name: "Sessions" })).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});
