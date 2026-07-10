/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { LimitContent } from "../LimitContent";

const mockPush = vi.fn();
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-123" },
    project: { id: "proj-123" },
  }),
}));

vi.mock("~/hooks/usePlanManagementUrl", () => ({
  usePlanManagementUrl: () => ({
    url: "/settings/subscription",
    buttonLabel: "Upgrade plan",
    isSaaS: true,
    isLoading: false,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    licenseEnforcement: {
      getLimitBreakdown: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("~/utils/tracking", () => ({ trackEvent: vi.fn() }));

vi.mock("../../ui/dialog", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: {
      Header: passthrough,
      Title: passthrough,
      Body: passthrough,
      Footer: passthrough,
    },
  };
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderLimit(resolution?: "purchase_seat" | "upgrade" | "hard_cap") {
  return render(
    <LimitContent
      variant={{
        mode: "limit",
        limitType: "members",
        current: 6,
        max: 6,
        resolution,
      }}
      onClose={vi.fn()}
    />,
    { wrapper: Wrapper },
  );
}

describe("<LimitContent/>", () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
    cleanup();
  });

  describe("when the denial resolves to upgrade", () => {
    /** @scenario Resolution upgrade routes to plan management */
    it("routes to the plan management page", () => {
      renderLimit("upgrade");

      fireEvent.click(screen.getByRole("button", { name: "Upgrade plan" }));

      expect(mockPush).toHaveBeenCalledWith("/settings/subscription");
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the denial resolves to hard_cap", () => {
    /** @scenario Resolution hard_cap directs to contact us */
    it("directs to contact us instead of plan management", () => {
      renderLimit("hard_cap");

      fireEvent.click(screen.getByRole("button", { name: "Contact us" }));

      expect(openSpy).toHaveBeenCalledWith(
        expect.stringContaining("langwatch.ai"),
        "_blank",
        "noopener",
      );
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
