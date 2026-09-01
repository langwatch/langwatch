/**
 * @vitest-environment jsdom
 *
 * The cost screen, mounted through its real guard stack.
 *
 * Only the boundaries are mocked — the layout chrome, the router, the plan and
 * the tRPC client. The permission decision is NOT: `hasAnyPermission` runs the
 * real `hasPermissionWithHierarchy` over the real built-in role bag, so a
 * `governanceCost:view` missing from that bag fails these tests rather than
 * shipping a screen nobody can open. The feature flag is real too — the tests
 * flip it and assert both directions.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getOrganizationRolePermissions,
  hasPermissionWithHierarchy,
} from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Whether the cost screen's release flag is on. */
  flagEnabled: true,
  /** Whether the organization has resolved yet. */
  organizationResolved: true,
  /** What the cost read answers. */
  query: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => {
  // The real permission check, not a stand-in: a `governanceCost:view`
  // missing from the built-in role bag has to fail these tests.
  const holds = (permission: string) =>
    hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: harness.organizationResolved
        ? { id: "org-1", slug: "acme", name: "ACME", teams: [] }
        : undefined,
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    // The section-wide flag stays on so the test is about THIS screen's flag.
    enabled:
      flag === "release_ui_governance_billed_cost_enabled"
        ? harness.flagEnabled
        : true,
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

// NotFoundScene paints to a canvas, which jsdom does not implement. The scene
// is a boundary here, not the thing under test — what matters is that it is
// what renders.
vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));

// The flag guard shows this first while the flag settles; without the stub a
// deny-path assertion can read the loading frame and pass for the wrong reason.
vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    governanceCost: {
      summary: {
        useQuery: () => harness.query,
      },
    },
  },
}));

import CostsPage from "../costs";

/** Every string a reader — eyes or screen reader — could get from a subtree. */
function readableStrings(element: HTMLElement): string[] {
  const strings: string[] = [element.textContent ?? ""];
  const own = element.getAttribute("aria-label");
  if (own) strings.push(own);
  for (const node of element.querySelectorAll("*")) {
    for (const attribute of ["aria-label", "aria-valuetext", "title", "alt"]) {
      const value = node.getAttribute(attribute);
      if (value) strings.push(value);
    }
  }
  return strings;
}

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CostsPage />
    </ChakraProvider>,
  );

/** The real org-admin bag, not a hand-written list that could drift from it. */
const ORG_ADMIN_PERMISSIONS = getOrganizationRolePermissions("ADMIN").slice();

function summaryFixture(overrides: Record<string, unknown> = {}) {
  return {
    unavailableReason: null,
    // Deliberately DIFFERENT figures: with the two equal, an implementation
    // that swapped the lanes wholesale would still pass the placement checks
    // below.
    billed: { amountUsd: 123.45, cellsWithoutAmount: 0 },
    gateway: { amountUsd: 67.89, cellsWithoutAmount: 0 },
    seats: { status: "awaiting_data" },
    series: [{ day: "2026-08-01", billedUsd: 123.45, gatewayUsd: 67.89 }],
    windowDays: 30,
    ...overrides,
  };
}

beforeEach(() => {
  harness.permissions = ORG_ADMIN_PERMISSIONS;
  harness.flagEnabled = true;
  harness.organizationResolved = true;
  harness.query = { data: summaryFixture(), isLoading: false, isError: false };
});

afterEach(() => cleanup());

describe("the governance cost screen", () => {
  describe("given a permitted viewer and both lanes reporting", () => {
    /** @scenario "Each lane renders its own labeled total" */
    it("renders each lane's own amount under its own label", () => {
      const fixture = summaryFixture();
      // The fixture only proves cross-lane placement if the two differ.
      expect(fixture.billed.amountUsd).not.toBe(fixture.gateway.amountUsd);

      renderScreen();

      const billed = screen.getByTestId("cost-lane-billed");
      const gateway = screen.getByTestId("cost-lane-gateway");

      expect(
        within(billed).getByText("Billed by provider"),
      ).toBeInTheDocument();
      expect(within(billed).getByText("$123.45")).toBeInTheDocument();
      expect(within(billed).queryByText("$67.89")).not.toBeInTheDocument();

      expect(
        within(gateway).getByText("Metered by gateway"),
      ).toBeInTheDocument();
      expect(within(gateway).getByText("$67.89")).toBeInTheDocument();
      expect(within(gateway).queryByText("$123.45")).not.toBeInTheDocument();
    });
  });

  describe("given seat data has not shipped yet", () => {
    /** @scenario "The seat lane is an honest hole until a licence list is read" */
    it("labels the seat lane, says it is waiting, and renders no digits", () => {
      renderScreen();

      const seats = screen.getByTestId("cost-lane-seats");
      expect(within(seats).getByText("Seats")).toBeInTheDocument();
      expect(within(seats).getByText(/not yet available/i)).toBeInTheDocument();

      // A digit anywhere in this lane — including one hiding in an accessible
      // name — would be a number about money nobody has measured.
      for (const readable of readableStrings(seats)) {
        expect(readable).not.toMatch(/\d/);
      }
    });
  });

  describe("given the tenant's seat licences have been read", () => {
    /** @scenario "The seat lane shows how many seats are bought and how many are assigned" */
    it("shows each pool's bought and assigned counts, and no money", () => {
      harness.query = {
        data: summaryFixture({
          seats: {
            status: "reported",
            pools: [
              {
                skuPartNumber: "AGENT_SEAT_USL",
                day: "2026-08-01",
                seatsBought: 4,
                seatsAssigned: 2,
              },
            ],
          },
        }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      const seats = screen.getByTestId("cost-lane-seats");
      expect(within(seats).getByText("Seats")).toBeInTheDocument();
      expect(within(seats).getByText("AGENT_SEAT_USL")).toBeInTheDocument();
      expect(within(seats).getByText(/4/)).toBeInTheDocument();
      expect(within(seats).getByText(/2/)).toBeInTheDocument();
      expect(
        within(seats).queryByText(/not yet available/i),
      ).not.toBeInTheDocument();

      // Seat events carry counts, not prices. A currency figure in this lane
      // would be money nobody billed, sitting beside the invoice that already
      // says what the seats cost.
      for (const readable of readableStrings(seats)) {
        expect(readable).not.toMatch(/[$€£]/);
      }
    });
  });

  describe("given the screen's release flag is off for a permitted viewer", () => {
    /** @scenario "The screen stays behind its release flag" */
    it("shows the not-found screen in its place", () => {
      // The actor HOLDS the permission and the organization IS resolved, so
      // neither the permission guard nor the unresolved-org branch can be what
      // hides the page.
      expect(
        hasPermissionWithHierarchy(harness.permissions, "governanceCost:view"),
      ).toBe(true);
      expect(harness.organizationResolved).toBe(true);

      harness.flagEnabled = false;
      renderScreen();

      expect(screen.getByText("this page does not exist")).toBeInTheDocument();
      expect(screen.queryByTestId("cost-lane-billed")).not.toBeInTheDocument();

      // …and the identical setup with the flag ON renders the screen, which is
      // what makes the assertion above about the FLAG.
      cleanup();
      harness.flagEnabled = true;
      renderScreen();
      expect(screen.getByTestId("cost-lane-billed")).toBeInTheDocument();
    });
  });

  describe("given the cost read fails", () => {
    /** @scenario "A failed cost read never renders as zero" */
    it("shows an error state and no zero amount", () => {
      harness.query = { data: undefined, isLoading: false, isError: true };
      renderScreen();

      expect(screen.getByTestId("cost-lanes-error")).toBeInTheDocument();
      expect(
        screen.queryByTestId("cost-lanes-loading"),
      ).not.toBeInTheDocument();
      // A `?? 0` on the failed read is exactly the defect this forbids.
      expect(document.body.textContent).not.toMatch(/\$0(\.00)?\b/);
    });
  });

  describe("given a deployment with no cost store", () => {
    /** @scenario "A deployment without a cost store shows unavailable, not zero" */
    it("states cost data is unavailable and shows no zero amount", () => {
      harness.query = {
        data: summaryFixture({
          unavailableReason: "no_cost_store",
          billed: { amountUsd: null, cellsWithoutAmount: 0 },
          gateway: { amountUsd: null, cellsWithoutAmount: 0 },
          series: [],
        }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      expect(screen.getByTestId("cost-lanes-unavailable")).toBeInTheDocument();
      expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/\$0(\.00)?\b/);
    });
  });

  describe("given a billed day whose total is negative", () => {
    /** @scenario "A refund-heavy billed day renders negative as reported" */
    it("shows the negative amount on the mounted billed lane", () => {
      harness.query = {
        data: summaryFixture({
          billed: { amountUsd: -42.5, cellsWithoutAmount: 0 },
          series: [{ day: "2026-08-01", billedUsd: -42.5, gatewayUsd: 67.89 }],
        }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      // Mounted, not formatted in isolation: the lane has to be on screen for
      // this to say anything about the screen.
      const billed = screen.getByTestId("cost-lane-billed");
      expect(within(billed).getByText("-$42.50")).toBeInTheDocument();
    });
  });

  describe("given a viewer whose role bag omits the cost permission", () => {
    it("does not render the lanes", () => {
      // Not a spec scenario — the guard's negative half, so the permission
      // assertions above cannot pass by the guard being absent entirely.
      harness.permissions = ["organization:view"];
      renderScreen();

      expect(screen.queryByTestId("cost-lane-billed")).not.toBeInTheDocument();
    });
  });
});
