/**
 * @vitest-environment jsdom
 *
 * Corresponds to specs/auth/impersonation-banner.feature.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImpersonationBanner } from "../ImpersonationBanner";

// Leaving for the admin panel is a full navigation, which jsdom does not
// perform and never records. The navigation seam is the only place it shows.
const { hardNavigate } = vi.hoisted(() => ({ hardNavigate: vi.fn() }));

vi.mock("~/utils/browserNavigation", () => ({
  hardNavigate,
  replaceLocation: vi.fn(),
  reloadPage: vi.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ImpersonationBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    hardNavigate.mockClear();
  });

  describe("when user is not being impersonated", () => {
    /** @scenario Impersonation banner does not appear for normal sessions */
    it("renders nothing", () => {
      const { container } = render(
        <ImpersonationBanner
          user={{ name: "Alice", email: "alice@test.com" }}
        />,
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

    /** @scenario An impersonation banner appears in the header */
    it("names the person being impersonated and offers to stop", () => {
      render(<ImpersonationBanner user={impersonatedUser} />, { wrapper });
      expect(screen.getByText("Impersonating Target User")).toBeInTheDocument();
      // Chakra renders multiple copies for responsive breakpoints
      const stopLinks = screen.getAllByRole("link", { name: "Stop" });
      expect(stopLinks.length).toBeGreaterThan(0);
    });

    it("falls back to email when name is null", () => {
      render(
        <ImpersonationBanner
          user={{
            ...impersonatedUser,
            name: null,
          }}
        />,
        { wrapper },
      );
      expect(
        screen.getByText("Impersonating target@test.com"),
      ).toBeInTheDocument();
    });

    /** @scenario Clicking stop ends impersonation */
    it("ends the impersonation and returns the admin to the admin panel", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 200 }));

      render(<ImpersonationBanner user={impersonatedUser} />, { wrapper });

      fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/admin/impersonate", {
          method: "DELETE",
        });
      });
      await waitFor(() => {
        expect(hardNavigate).toHaveBeenCalledWith("/admin#/user");
      });
    });

    it("stays put when the impersonation could not be ended", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 500 }),
      );

      render(<ImpersonationBanner user={impersonatedUser} />, { wrapper });

      fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

      // Leaving for the admin panel while still impersonating would hide the
      // one banner that says so.
      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalled();
      });
      expect(hardNavigate).not.toHaveBeenCalled();
    });
  });
});
