/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImpersonationBanner } from "../ImpersonationBanner";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

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

    it("displays the impersonation text and stop action", () => {
      render(<ImpersonationBanner user={impersonatedUser} />, { wrapper });
      expect(
        screen.getByText("Impersonating Target User"),
      ).toBeInTheDocument();
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

    it("sends DELETE request when Stop is clicked", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(null, { status: 200 }),
      );

      render(<ImpersonationBanner user={impersonatedUser} />, { wrapper });

      fireEvent.click(screen.getAllByRole("link", { name: "Stop" })[0]!);

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/admin/impersonate", {
          method: "DELETE",
        });
      });
    });
  });
});
