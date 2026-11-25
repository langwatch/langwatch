/**
 * @vitest-environment jsdom
 * An organization whose plan shrank under it keeps its members; every page
 * says so and links to the subscription page (specs/licensing/subscription-page.feature).
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ShellPageBody } from "../shell-page-body.tsx";

type SeatLimitStatus = "ok" | "exceeded";

const { usage } = vi.hoisted(() => ({
  usage: {
    data: undefined as
      | {
          currentMonthCost: number;
          maxMonthlyUsageLimit: number;
          messageLimitInfo: { status: "ok"; message: string };
          seatLimitInfo: { status: SeatLimitStatus; message: string };
          activePlan: {
            type: string;
            paymentFailed?: boolean;
            overPlan?: { sinceMs: number; members: number; maxMembers: number } | null;
          };
        }
      | undefined,
  },
}));

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    limits: { getUsage: { useQuery: () => ({ data: usage.data }) } },
    user: { getSsoStatus: { useQuery: () => ({ data: undefined }) } },
    governance: {
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

function givenSeatLimit({
  status,
  message,
  planType = "FREE",
  paymentFailed,
  overPlan,
}: {
  status: SeatLimitStatus;
  message: string;
  planType?: string;
  paymentFailed?: boolean;
  overPlan?: { sinceMs: number; members: number; maxMembers: number };
}) {
  usage.data = {
    currentMonthCost: 0,
    maxMonthlyUsageLimit: 100,
    messageLimitInfo: { status: "ok", message: "" },
    seatLimitInfo: { status, message },
    activePlan: { type: planType, paymentFailed, overPlan },
  };
}

const OVER_SEATS =
  "Your organization uses 8 member seats and your plan includes 2 member seats. Your organization uses 5 Lite Member seats and your plan includes no Lite Member seats.";

beforeEach(() => {
  usage.data = undefined;
});

afterEach(() => cleanup());

function renderPage({ isSaaS = true }: { isSaaS?: boolean } = {}) {
  renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        pathname: "/acme",
        currentUserId: "user_1",
        organization: { id: "org_1", name: "Acme", teams: [] },
        team: {
          id: "team_1",
          name: "Team",
          isPersonal: false,
          members: [{ userId: "user_1" }],
          projects: [],
        },
        project: { id: "proj_1", name: "Project", slug: "acme" },
        organizationRole: "MEMBER",
        deployment: { isSaaS },
        permissions: ["organization:view"],
      }}
    >
      <ShellPageBody>
        <p>Page content</p>
      </ShellPageBody>
    </WithStubNavigationHost>,
  );
}

describe("<ShellPageBody/> seat limit banner", () => {
  describe("when the organization uses more seats than its plan includes", () => {
    /** @scenario "Every page shows the upgrade banner while the seat limit is exceeded" */
    it("shows the seat counts and links to the subscription page", () => {
      givenSeatLimit({
        status: "exceeded",
        message: "Your organization uses 3 member seats and your plan includes 2 member seats.",
      });

      renderPage();

      expect(screen.getByTestId("seat-limit-banner")).toHaveTextContent(
        "Your organization uses 3 member seats and your plan includes 2 member seats. Upgrade your plan to keep everyone.",
      );
      expect(screen.getByRole("link", { name: "Compare plans" })).toHaveAttribute(
        "href",
        "/settings/subscription",
      );
      expect(screen.getByText("Page content")).toBeInTheDocument();
    });
  });

  describe("when an Enterprise organization uses more seats than it bought", () => {
    it("offers to contact sales instead of an upgrade", () => {
      givenSeatLimit({ status: "exceeded", message: "Over the limit.", planType: "ENTERPRISE" });

      renderPage();

      expect(screen.getByTestId("seat-limit-banner")).toHaveTextContent(
        "Over the limit. Contact sales to add seats.",
      );
      expect(screen.queryByRole("link", { name: "Compare plans" })).toBeNull();
    });
  });

  describe("when a self-hosted install uses more seats than its license holds", () => {
    /** @scenario "The seat banner on a self-hosted install offers the license, not the plans" */
    it("offers to manage the license instead of comparing plans", () => {
      givenSeatLimit({ status: "exceeded", message: "Over the limit.", planType: "ENTERPRISE" });

      renderPage({ isSaaS: false });

      expect(screen.getByTestId("seat-limit-banner")).toHaveTextContent(
        "Your organization has more members than your license includes Add seats to your license to keep everyone.",
      );
      expect(screen.getByTestId("seat-limit-banner")).not.toHaveTextContent("plan");
      expect(screen.getByRole("link", { name: "Manage license" })).toHaveAttribute(
        "href",
        "/settings/license",
      );
      expect(screen.queryByRole("link", { name: "Compare plans" })).toBeNull();
    });
  });

  describe("when a payment failed and the organization also uses more seats than its plan", () => {
    /** @scenario "Only one plan banner shows at a time" */
    it("leaves the plan banner to the failed payment and hides the seat banner", () => {
      givenSeatLimit({ status: "exceeded", message: OVER_SEATS, paymentFailed: true });

      renderPage();

      expect(screen.queryByTestId("seat-limit-banner")).toBeNull();
      expect(screen.queryByRole("link", { name: "Compare plans" })).toBeNull();
      expect(screen.getByText("Page content")).toBeInTheDocument();
    });
  });

  describe("when the organization is over its plan and its new traces are withheld", () => {
    /** @scenario "An over-plan organization sees one banner with the seat counts and both actions" */
    it("shows one banner with the seat counts, both actions and no card ask", () => {
      givenSeatLimit({
        status: "exceeded",
        message: OVER_SEATS,
        overPlan: { sinceMs: 1, members: 13, maxMembers: 2 },
      });

      renderPage();

      const banners = screen.getAllByTestId("seat-limit-banner");
      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveTextContent(
        `${OVER_SEATS} New traces are saved and will show once you upgrade your plan or remove members.`,
      );
      expect(banners[0]).not.toHaveTextContent(/card/i);
      expect(screen.getByRole("link", { name: "Compare plans" })).toHaveAttribute(
        "href",
        "/settings/subscription",
      );
      expect(screen.getByRole("link", { name: "Manage members" })).toHaveAttribute(
        "href",
        "/settings/members",
      );
    });
  });

  describe("when the organization is within its plan's seats", () => {
    /** @scenario "The upgrade banner is not shown while seats are within the plan" */
    it("does not show the seat limit banner", () => {
      givenSeatLimit({ status: "ok", message: "" });

      renderPage();

      expect(screen.queryByTestId("seat-limit-banner")).toBeNull();
    });
  });
});
