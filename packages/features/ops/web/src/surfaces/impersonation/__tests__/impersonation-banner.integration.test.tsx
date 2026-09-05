/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImpersonationBanner } from "../index";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ImpersonationBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("when user is not being impersonated", () => {
    it("renders nothing", () => {
      const { container } = render(
        <ImpersonationBanner onStop={() => {}} user={{ name: "Alice", email: "alice@test.com" }} />,
        { wrapper },
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
      render(<ImpersonationBanner onStop={() => {}} user={impersonatedUser} />, { wrapper });
      expect(screen.getByText("Impersonating Target User")).not.toBeNull();
      // Chakra renders multiple copies for responsive breakpoints
      const stopLinks = screen.getAllByRole("link", { name: "Stop" });
      expect(stopLinks.length).toBeGreaterThan(0);
    });

    it("falls back to email when name is null", () => {
      render(
        <ImpersonationBanner
          onStop={() => {}}
          user={{
            ...impersonatedUser,
            name: null,
          }}
        />,
        { wrapper },
      );
      expect(screen.getByText("Impersonating target@test.com")).not.toBeNull();
    });

    it("asks the mounting feature to stop when Stop is clicked", () => {
      const onStop = vi.fn();

      render(<ImpersonationBanner onStop={onStop} user={impersonatedUser} />, { wrapper });

      fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });
});
