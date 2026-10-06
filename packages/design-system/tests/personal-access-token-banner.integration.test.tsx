// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonalAccessTokenBanner } from "../src/components/personal-access-token-banner.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function renderBanner({ token, createLabel }: { token: string | null; createLabel?: string }) {
  renderWithDesignSystem(
    <PersonalAccessTokenBanner
      token={token}
      isCreating={false}
      onCreate={vi.fn()}
      createLabel={createLabel}
    />,
  );
}

describe("PersonalAccessTokenBanner", () => {
  describe("when no label is given and no token exists", () => {
    it("offers the personal access token wording", () => {
      renderBanner({ token: null });

      expect(screen.getByRole("button", { name: "Create a personal access token" })).toBeTruthy();
    });
  });

  describe("when a create label is given and no token exists", () => {
    it("offers that label instead", () => {
      renderBanner({ token: null, createLabel: "Create a key" });

      expect(screen.getByRole("button", { name: "Create a key" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Create a personal access token" })).toBeNull();
    });
  });

  describe("when a token exists", () => {
    it("offers to create another whatever the label", () => {
      renderBanner({ token: "pat-secret", createLabel: "Create a key" });

      expect(screen.getByRole("button", { name: "Create another" })).toBeTruthy();
    });
  });
});
