/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { UpgradeModal } from "../UpgradeModal";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";

// Mock dependencies used by other content variants
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    pathname: "/[project]/evaluations",
    query: {},
  })),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "project-1" },
  })),
}));

vi.mock("../../hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: vi.fn(() => ({
    url: "/settings/plan",
    buttonLabel: "Manage Plan",
  })),
}));

vi.mock("../../utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}

describe("<UpgradeModal />", () => {
  describe("when variant is liteMemberRestriction", () => {
    const variant: UpgradeModalVariant = {
      mode: "liteMemberRestriction",
      resource: "scenarios",
    };

    let onClose: () => void;

    beforeEach(() => {
      onClose = vi.fn();
    });

    it("renders the 'Feature Not Available' title", () => {
      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={variant} />,
      );

      expect(screen.getByText("Feature Not Available")).toBeDefined();
    });

    it("renders role-based messaging without billing references", () => {
      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={variant} />,
      );

      // Chakra Dialog renders content twice; use getAllByText
      const textElements = screen.getAllByText(
        "This feature is not available for your current role. Contact your organization admin for access.",
      );
      expect(textElements.length).toBeGreaterThan(0);

      expect(screen.queryByText(/plan/i)).toBeNull();
      expect(screen.queryByText(/billing/i)).toBeNull();
      expect(screen.queryByText(/pricing/i)).toBeNull();
      expect(screen.queryByText(/upgrade/i)).toBeNull();
    });

    it("does not render an 'Upgrade' button", () => {
      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={variant} />,
      );

      expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /manage plan/i })).toBeNull();
    });

    it("renders a Dismiss button that calls onClose", () => {
      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={variant} />,
      );

      // Chakra Dialog may render duplicate nodes; use last match
      const dismissButtons = screen.getAllByRole("button", { name: "Dismiss" });
      expect(dismissButtons.length).toBeGreaterThan(0);

      fireEvent.click(dismissButtons[dismissButtons.length - 1]!);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
