/**
 * @vitest-environment jsdom
 *
 * See specs/licensing/proration-preview.feature for the Upgrade Modal
 * (limit + seats mode) acceptance scenarios this file binds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { UpgradeModal } from "../UpgradeModal";
import { trackEvent } from "../../utils/tracking";
import { toaster } from "../ui/toaster";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";

const { pushMock, previewProrationMock, subscriptionEnabled } = vi.hoisted(
  () => ({
    pushMock: vi.fn(),
    previewProrationMock: vi.fn(),
    subscriptionEnabled: { value: true },
  }),
);

// Mock dependencies used by other content variants
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: vi.fn(() => ({
    push: pushMock,
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

vi.mock("../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// `api.subscription` is undefined in OSS builds (see UpgradeModal.tsx's
// `hasSubscriptionApi` guard); the getter re-evaluates `subscriptionEnabled`
// on every access so a single test can flip it without a module reset.
vi.mock("../../utils/api", () => ({
  api: {
    get subscription() {
      return subscriptionEnabled.value
        ? { previewProration: { useQuery: previewProrationMock } }
        : undefined;
    },
  },
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<UpgradeModal />", () => {
  afterEach(() => {
    vi.clearAllMocks();
    subscriptionEnabled.value = true;
  });

  describe("when variant is limit", () => {
    const variant: UpgradeModalVariant = {
      mode: "limit",
      limitType: "members",
      current: 5,
      max: 5,
    };

    let onClose: () => void;

    beforeEach(() => {
      onClose = vi.fn();
    });

    /** @scenario Existing limit upgrade modal still works for non-SEAT_EVENT limits */
    it("shows the limit title, current usage, and a redirect button to plan management", () => {
      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={variant} />,
      );

      expect(screen.getAllByText("Upgrade Required").length).toBeGreaterThan(
        0,
      );
      expect(
        screen.getAllByText(/reached the limit of 5 team members/i).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText("Current usage: 5 / 5").length,
      ).toBeGreaterThan(0);

      const upgradeButtons = screen.getAllByRole("button", {
        name: "Manage Plan",
      });
      fireEvent.click(upgradeButtons[upgradeButtons.length - 1]!);

      expect(trackEvent).toHaveBeenCalledWith("subscription_hook_click", {
        project_id: "project-1",
        hook: "members_limit_reached",
      });
      expect(pushMock).toHaveBeenCalledWith("/settings/plan");
      expect(onClose).toHaveBeenCalled();
    });

    it("omits the current-usage line when max is not a finite number", () => {
      const unlimitedVariant: UpgradeModalVariant = {
        mode: "limit",
        limitType: "membersLite",
        current: 3,
        // Defensive branch: `LimitContent` falls back to a maxless message
        // whenever `typeof variant.max !== "number"`.
        max: undefined as unknown as number,
      };

      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={unlimitedVariant} />,
      );

      expect(
        screen.getAllByText(/reached the limit of lite members/i).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(/current usage/i)).toBeNull();
    });

    it("renders a Cancel button that closes without navigating", () => {
      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={variant} />,
      );

      const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
      fireEvent.click(cancelButtons[cancelButtons.length - 1]!);

      expect(onClose).toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  describe("when variant is seats", () => {
    const baseVariant: UpgradeModalVariant = {
      mode: "seats",
      organizationId: "org-1",
      currentSeats: 5,
      newSeats: 7,
      onConfirm: vi.fn(),
    };

    let onClose: () => void;

    beforeEach(() => {
      onClose = vi.fn();
      previewProrationMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: false,
      });
    });

    /** @scenario Seats mode modal shows the recurring total after a seat update */
    it("shows the title, current/new seat counts, and the new recurring total", () => {
      previewProrationMock.mockReturnValue({
        data: {
          formattedRecurringTotal: "$199.00 / mo",
          billingInterval: "month",
        },
        isLoading: false,
        isError: false,
      });

      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={baseVariant} />,
      );

      expect(
        screen.getAllByText("Confirm Seat Update").length,
      ).toBeGreaterThan(0);
      expect(screen.getAllByText("5").length).toBeGreaterThan(0);
      expect(screen.getAllByText("7").length).toBeGreaterThan(0);
      expect(screen.getAllByText("New billing amount").length).toBeGreaterThan(
        0,
      );
      expect(
        screen.getAllByText("$199.00 / mo").length,
      ).toBeGreaterThan(0);
    });

    /** @scenario Seats mode modal shows loading state while fetching preview */
    it("shows a spinner while the preview query is loading", () => {
      previewProrationMock.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
      });

      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={baseVariant} />,
      );

      expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
      expect(screen.queryByText(/new billing amount/i)).toBeNull();

      const confirmButtons = screen.getAllByRole("button", {
        name: "Confirm & Update",
      });
      expect(confirmButtons[confirmButtons.length - 1]).toBeDisabled();
    });

    /** @scenario Seats mode modal shows error state on preview failure */
    it("shows an error message and disables Confirm & Update on preview failure", () => {
      previewProrationMock.mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        error: { message: "Could not reach billing provider" },
      });

      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={baseVariant} />,
      );

      expect(
        screen.getAllByText("Could not reach billing provider").length,
      ).toBeGreaterThan(0);

      const confirmButtons = screen.getAllByRole("button", {
        name: "Confirm & Update",
      });
      expect(confirmButtons[confirmButtons.length - 1]).toBeDisabled();
    });

    /** @scenario Cancelling proration preview does nothing */
    it("closes without confirming when Cancel is clicked", () => {
      const onConfirm = vi.fn();
      renderWithProviders(
        <UpgradeModal
          open={true}
          onClose={onClose}
          variant={{ ...baseVariant, onConfirm }}
        />,
      );

      const cancelButtons = screen.getAllByRole("button", { name: "Cancel" });
      fireEvent.click(cancelButtons[cancelButtons.length - 1]!);

      expect(onClose).toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("calls onConfirm and closes when Confirm & Update succeeds", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      renderWithProviders(
        <UpgradeModal
          open={true}
          onClose={onClose}
          variant={{ ...baseVariant, onConfirm }}
        />,
      );

      const confirmButtons = screen.getAllByRole("button", {
        name: "Confirm & Update",
      });
      fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

      await waitFor(() => expect(onConfirm).toHaveBeenCalled());
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(toaster.create).not.toHaveBeenCalled();
    });

    it("shows an error toast and keeps the modal open when onConfirm rejects", async () => {
      const onConfirm = vi.fn().mockRejectedValue(new Error("Payment declined"));
      renderWithProviders(
        <UpgradeModal
          open={true}
          onClose={onClose}
          variant={{ ...baseVariant, onConfirm }}
        />,
      );

      const confirmButtons = screen.getAllByRole("button", {
        name: "Confirm & Update",
      });
      fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

      await waitFor(() =>
        expect(toaster.create).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Error updating seats",
            description: "Payment declined",
            type: "error",
          }),
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
    });

    it("shows a deployment message and no Confirm button when the subscription API is unavailable (OSS build)", () => {
      subscriptionEnabled.value = false;

      renderWithProviders(
        <UpgradeModal open={true} onClose={onClose} variant={baseVariant} />,
      );

      expect(
        screen.getAllByText("Seat management is not available in this deployment.")
          .length,
      ).toBeGreaterThan(0);

      const confirmButtons = screen.getAllByRole("button", {
        name: "Confirm & Update",
      });
      expect(confirmButtons[confirmButtons.length - 1]).toBeDisabled();
    });
  });

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
