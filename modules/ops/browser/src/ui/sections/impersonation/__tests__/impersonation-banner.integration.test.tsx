/**
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImpersonationBanner } from "../index.ts";

describe("ImpersonationBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("when user is not being impersonated", () => {
    it("renders nothing", () => {
      const { container } = renderWithDesignSystem(
        <ImpersonationBanner onStop={() => {}} user={{ name: "Alice", email: "alice@test.com" }} />,
      );
      expect(container.innerHTML).toBe("");
    });
  });

  describe("when user is being impersonated", () => {
    const impersonatedUser = {
      name: "Target User",
      email: "target@test.com",
      impersonator: {
        id: "admin-id",
        name: "Admin",
        email: "admin@test.com",
      },
    };

    it("displays the impersonation text and stop action", () => {
      renderWithDesignSystem(<ImpersonationBanner onStop={() => {}} user={impersonatedUser} />);
      expect(screen.getByText("Impersonating Target User")).not.toBeNull();
      // Chakra renders multiple copies for responsive breakpoints
      const stopLinks = screen.getAllByRole("link", { name: "Stop" });
      expect(stopLinks.length).toBeGreaterThan(0);
    });

    it("falls back to email when name is null", () => {
      renderWithDesignSystem(
        <ImpersonationBanner
          onStop={() => {}}
          user={{
            ...impersonatedUser,
            name: null,
          }}
        />,
      );
      expect(screen.getByText("Impersonating target@test.com")).not.toBeNull();
    });

    it("asks the mounting feature to stop when Stop is clicked", () => {
      const onStop = vi.fn();

      renderWithDesignSystem(<ImpersonationBanner onStop={onStop} user={impersonatedUser} />);

      fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });
});
