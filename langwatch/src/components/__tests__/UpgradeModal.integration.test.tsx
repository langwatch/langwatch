/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { UpgradeModal } from "../UpgradeModal";
import {
  FREE_PLAN_FEATURES,
  GROWTH_PLAN_FEATURES,
} from "../subscription/billing-plans";
import type { UpgradeModalVariant } from "../../stores/upgradeModalStore";

// ---------------------------------------------------------------------------
// Mutable mock state
// ---------------------------------------------------------------------------
let mockActivePlanData: Record<string, unknown> | undefined = undefined;
let mockActivePlanLoading = false;
let mockActivePlanError = false;

const mockRouterPush = vi.fn();
const mockOnClose = vi.fn();

// ---------------------------------------------------------------------------
// vi.mock declarations
// ---------------------------------------------------------------------------
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    query: {},
    asPath: "/test",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("~/hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: () => ({
    url: "/settings/subscription",
    buttonLabel: "Upgrade plan",
  }),
}));

vi.mock("~/utils/tracking", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    plan: {
      getActivePlan: {
        useQuery: () => ({
          data: mockActivePlanData,
          isLoading: mockActivePlanLoading,
          isError: mockActivePlanError,
        }),
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderModal(
  variant: UpgradeModalVariant = makeLimitVariant(),
  onClose = mockOnClose,
) {
  return render(
    <UpgradeModal open={true} onClose={onClose} variant={variant} />,
    { wrapper: Wrapper },
  );
}

function makeLimitVariant(
  overrides: Partial<Extract<UpgradeModalVariant, { mode: "limit" }>> = {},
): Extract<UpgradeModalVariant, { mode: "limit" }> {
  return {
    mode: "limit",
    limitType: "workflows",
    current: 3,
    max: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  mockActivePlanData = {
    name: "Free",
    planSource: "free",
    overrideAddingLimitations: false,
    free: true,
  };
  mockActivePlanLoading = false;
  mockActivePlanError = false;
  mockRouterPush.mockClear();
  mockOnClose.mockClear();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("UpgradeModal LimitContent", () => {
  describe("when plan data is loaded", () => {
    it("renders the current plan name in the left column", () => {
      renderModal();

      expect(screen.getByText("Free plan")).toBeInTheDocument();
    });

    it("renders the trigger message", () => {
      renderModal(makeLimitVariant({ max: 3, limitType: "workflows" }));

      expect(
        screen.getByText(/You've reached the limit of/),
      ).toBeInTheDocument();
    });
  });

  describe("when showing two-column comparison", () => {
    it("renders the current plan features in the left column", () => {
      renderModal();

      for (const feature of FREE_PLAN_FEATURES) {
        expect(screen.getByText(feature)).toBeInTheDocument();
      }
    });

    it("renders Growth plan features in the right column", () => {
      renderModal();

      expect(screen.getByText("Growth plan")).toBeInTheDocument();
      for (const feature of GROWTH_PLAN_FEATURES) {
        expect(screen.getByText(feature)).toBeInTheDocument();
      }
    });

    it("renders a Recommended badge on the Growth column", () => {
      renderModal();

      expect(screen.getByText("Recommended")).toBeInTheDocument();
    });
  });

  describe("when plan data is loading", () => {
    it("does not show plan name while loading", () => {
      mockActivePlanData = undefined;
      mockActivePlanLoading = true;
      renderModal();

      expect(screen.queryByText("Free plan")).not.toBeInTheDocument();
    });
  });

  describe("when plan API fails", () => {
    it("degrades gracefully showing trigger message and upgrade button", () => {
      mockActivePlanData = undefined;
      mockActivePlanError = true;
      renderModal();

      expect(
        screen.getByText(/You've reached the limit/),
      ).toBeInTheDocument();
      expect(screen.getByText("Upgrade plan")).toBeInTheDocument();
    });

    it("does not show comparison columns", () => {
      mockActivePlanData = undefined;
      mockActivePlanError = true;
      renderModal();

      expect(screen.queryByText("Growth plan")).not.toBeInTheDocument();
    });
  });

  describe("when overrideAddingLimitations is true", () => {
    it("hides the comparison columns", () => {
      mockActivePlanData = {
        name: "Enterprise",
        planSource: "subscription",
        overrideAddingLimitations: true,
      };
      renderModal();

      expect(screen.queryByText("Growth plan")).not.toBeInTheDocument();
    });
  });

  describe("when planSource is license", () => {
    it("hides the comparison columns for self-hosted plans", () => {
      mockActivePlanData = {
        name: "Self-Hosted Pro",
        planSource: "license",
        overrideAddingLimitations: false,
      };
      renderModal();

      expect(screen.queryByText("Growth plan")).not.toBeInTheDocument();
    });
  });

  describe("when clicking the upgrade button", () => {
    it("navigates to subscription page and closes modal", async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByText("Upgrade plan"));

      expect(mockRouterPush).toHaveBeenCalledWith("/settings/subscription");
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
