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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

vi.mock("~/utils/api", () => {
  // The breakdown panels below the lanes read the activity monitor. They are
  // not what these tests are about, so they answer with nothing — which is
  // also the shape a viewer without `activityMonitor:view` sees. Leaving them
  // out entirely would crash the render before a single lane assertion ran.
  const empty = { useQuery: () => ({ data: undefined }) };
  return {
    api: {
      governanceCost: {
        summary: {
          useQuery: () => harness.query,
        },
        // The spender panel and the day split are their own reads with their
        // own tests; here they answer nothing so the lane assertions stay
        // about the lanes.
        spenders: empty,
        dailyByProvider: empty,
        // The ranked model panel reads the billed rollup now rather
        // than the activity monitor; it answers nothing here too.
        spendByModel: empty,
      },
      activityMonitor: {
        summary: empty,
        spendByDepartment: empty,
        spendByUser: empty,
        spendOverTime: empty,
      },
    },
  };
});

import { findNativeSelects } from "~/components/governance/filters";
import BilledPage from "../billed";
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
    billed: {
      amountUsd: 123.45,
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
      // The US dollar line IS the lane's dollar total, so the default fixture
      // states it once and the two agree by construction.
      currencyTotals: [
        { currencyCode: "USD", amount: 123.45, cellsWithoutAmount: 0 },
      ],
    },
    gateway: {
      amountUsd: 67.89,
      cellsWithoutAmount: 0,
      currenciesWithoutUsdAmount: [],
      currencyTotals: [
        { currencyCode: "USD", amount: 67.89, cellsWithoutAmount: 0 },
      ],
    },
    seats: { status: "awaiting_data" },
    series: [
      {
        day: "2026-08-01",
        billedUsd: 123.45,
        gatewayUsd: 67.89,
        billedCellsWithoutAmount: 0,
        gatewayCellsWithoutAmount: 0,
      },
    ],
    windowDays: 30,
    // Every source still pulling, so the figures need no caveat.
    staleSources: null,
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
  /** @scenario "A cost-only viewer sees provider costs inside the billed card" */
  it("shows provider bars in the billed card without people or activity permissions", () => {
    harness.permissions = ["governanceCost:view", "organization:view"];
    harness.query.data = summaryFixture({
      providers: [
        { provider: "openai_admin", amountUsd: 100, cellsWithoutAmount: 0 },
        {
          provider: "anthropic_admin",
          amountUsd: 23.45,
          cellsWithoutAmount: 0,
        },
      ],
    });
    renderScreen();
    const card = within(screen.getByTestId("cost-lane-billed"));
    expect(card.getByText("$123.45")).toBeInTheDocument();
    expect(card.getByText("OpenAI")).toBeInTheDocument();
    expect(card.getByText("Anthropic")).toBeInTheDocument();
    expect(card.getByText("$100.00")).toBeInTheDocument();
    expect(card.getByText("$23.45")).toBeInTheDocument();
    expect(card.queryByText("$67.89")).not.toBeInTheDocument();
  });

  /** @scenario "Missing provider prices are not displayed as zero" */
  it("shows an unavailable provider amount and preserves a refund", () => {
    harness.query.data = summaryFixture({
      providers: [
        { provider: "openai_admin", amountUsd: null, cellsWithoutAmount: 1 },
        { provider: "anthropic_admin", amountUsd: -2, cellsWithoutAmount: 0 },
      ],
    });
    renderScreen();
    const card = within(screen.getByTestId("cost-lane-billed"));
    expect(card.getByText("OpenAI")).toBeInTheDocument();
    expect(card.getByText("USD amount unavailable")).toBeInTheDocument();
    expect(card.getByText("-$2.00")).toBeInTheDocument();
    expect(card.queryByText("$0.00")).not.toBeInTheDocument();
  });

  describe("given an admin with Costs enabled", () => {
    /** @scenario "The unfinished Billed address stays unavailable when Costs is enabled" */
    it("shows not found at the unfinished Billed address", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <BilledPage />
        </ChakraProvider>,
      );
      expect(screen.getByText("this page does not exist")).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Billed" }),
      ).not.toBeInTheDocument();
    });
  });
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
      // Humanised for reading, with the provider's own SKU kept on the title
      // so it can still be matched against an invoice.
      const pool = within(seats).getByText("Agent Seat USL");
      expect(pool).toBeInTheDocument();
      expect(pool).toHaveAttribute("title", "AGENT_SEAT_USL");
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

  describe("given the seat read failed while the cost lanes answered", () => {
    /** @scenario "A failed seat read reads differently from one not yet taken" */
    it("says the seat data could not be read, and leaves the money lanes alone", () => {
      harness.query = {
        data: summaryFixture({ seats: { status: "read_failed" } }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      const seats = screen.getByTestId("cost-lane-seats");
      expect(within(seats).getByText(/could not be read/i)).toBeInTheDocument();
      // "Not read yet" and "could not be read" are different sentences, and
      // the lane saying the wrong one sends an admin looking for a licence
      // collection that already ran.
      expect(
        within(seats).queryByText(/not yet available/i),
      ).not.toBeInTheDocument();

      for (const readable of readableStrings(seats)) {
        expect(readable).not.toMatch(/\d/);
      }

      // The point of the state: one broken read no longer takes the money
      // lanes down with it.
      expect(
        within(screen.getByTestId("cost-lane-billed")).getByText("$123.45"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("cost-lane-gateway")).getByText("$67.89"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("cost-lanes-error")).not.toBeInTheDocument();
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
          billed: {
            amountUsd: null,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [],
          },
          gateway: {
            amountUsd: null,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [],
          },
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
          billed: {
            amountUsd: -42.5,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: -42.5, cellsWithoutAmount: 0 },
            ],
          },
          series: [
            {
              day: "2026-08-01",
              billedUsd: -42.5,
              gatewayUsd: 67.89,
              billedCellsWithoutAmount: 0,
              gatewayCellsWithoutAmount: 0,
            },
          ],
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

  describe("given a year in which every day cost exactly the same", () => {
    /** @scenario "A window whose spend never moved says level on both money lanes" */
    it("shows level on both money lanes rather than a rise off the calendar", () => {
      // A full year, every day identical. The interval in view buckets it by
      // the calendar, and the calendar hands back buckets of different sizes —
      // a part-month at each end, quarters of 90 to 92 days. Measured on those
      // buckets the card reported a large rise, on spending that never moved.
      const start = Date.UTC(2026, 0, 15);
      const series = Array.from({ length: 365 }, (_, index) => ({
        day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        billedUsd: 1000,
        gatewayUsd: 500,
        billedCellsWithoutAmount: 0,
        gatewayCellsWithoutAmount: 0,
      }));
      harness.query = {
        data: summaryFixture({
          billed: {
            amountUsd: 365_000,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 365_000, cellsWithoutAmount: 0 },
            ],
          },
          gateway: {
            amountUsd: 182_500,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 182_500, cellsWithoutAmount: 0 },
            ],
          },
          series,
          windowDays: 365,
        }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      // Mounted, not computed in isolation: the defect was never in the
      // percentage helper alone, it was in which series the screen handed it.
      expect(screen.getByTestId("cost-lane-billed-trend")).toHaveTextContent(
        "level",
      );
      expect(screen.getByTestId("cost-lane-gateway-trend")).toHaveTextContent(
        "level",
      );
    });
  });

  describe("given a lane whose dollar total was withheld over an unpriced part", () => {
    /** @scenario "A lane with no total says why instead of showing a figure" */
    it("shows no amount and says we hold no dollar figure for part of what it covers", () => {
      harness.query = {
        data: summaryFixture({
          billed: {
            amountUsd: null,
            cellsWithoutAmount: 4,
            currenciesWithoutUsdAmount: ["EUR"],
            currencyTotals: [
              { currencyCode: "USD", amount: null, cellsWithoutAmount: 4 },
            ],
          },
          series: [
            {
              day: "2026-08-01",
              billedUsd: null,
              gatewayUsd: 67.89,
              billedCellsWithoutAmount: 4,
              gatewayCellsWithoutAmount: 0,
            },
          ],
        }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      const billed = screen.getByTestId("cost-lane-billed");
      // No figure at all — and specifically not a zero, which would be a claim
      // that nothing was spent in a lane that plainly was.
      expect(within(billed).queryByText(/\$\d/)).not.toBeInTheDocument();
      expect(within(billed).getByText("—")).toBeInTheDocument();

      const note = within(billed).getByTestId("cost-lane-billed-note");
      // What the screen actually knows, and all it knows: part of this lane
      // holds no dollar figure. Two different causes produce that — spend the
      // provider billed in another currency, and spend read on a day when
      // cost recording was off — and copy naming a currency states a false
      // reason for the second, which a reader checking the invoice finds
      // wrong. Money billed in euros that we DO hold a figure for now has a
      // euro line of its own and is no longer a reason to withhold anything.
      expect(note).toHaveTextContent(/we hold no dollar figure for part of/i);
      expect(note).not.toHaveTextContent(/rather than US dollars/i);
      expect(note).not.toHaveTextContent(/billed in EUR/i);
      // The old copy said the usage "arrived without a stated amount", which
      // is not what happened: the provider stated it, in euros.
      expect(note).not.toHaveTextContent(/without a stated amount/i);

      // The lane that IS complete keeps its figure, so this cannot pass
      // against an implementation that blanks the screen whenever any lane is
      // withheld.
      const gateway = screen.getByTestId("cost-lane-gateway");
      expect(within(gateway).getByText("$67.89")).toBeInTheDocument();
      expect(
        within(gateway).queryByTestId("cost-lane-gateway-note"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a window billed in two currencies", () => {
    /** @scenario "A window billed in two currencies shows one total per currency" */
    it("shows one total per currency, combines neither, and applies no rate", () => {
      harness.query = {
        data: summaryFixture({
          billed: {
            // The US dollar line IS this number. It is stated once, and the
            // screen renders the lines rather than a second headline beside
            // them.
            amountUsd: 100,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "USD", amount: 100, cellsWithoutAmount: 0 },
              { currencyCode: "EUR", amount: 40, cellsWithoutAmount: 0 },
            ],
          },
        }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      const billed = within(screen.getByTestId("cost-lane-billed"));
      expect(billed.getByText("$100.00")).toBeInTheDocument();
      // The euros, in the currency they were billed in and named as such.
      const euros = billed.getByText(/(€|EUR)/);
      expect(euros).toBeInTheDocument();
      expect(readableStrings(euros).join(" ")).toMatch(/40/);

      // Nothing on the screen adds the two. 140 is what a rate of exactly one
      // would produce — but rejecting 140 alone only rules out that one rate,
      // and a conversion at 1.08 renders $143.20 through the same assertion
      // untouched. So the lane is read for EVERY money figure standing in it
      // and the whole list is pinned: one dollar figure, which is the dollars,
      // and one named-currency figure, which is the euros. A third of any size
      // fails, whatever rate produced it.
      const lane = screen.getByTestId("cost-lane-billed");
      const spoken = lane.textContent ?? "";
      expect(spoken.match(/-?\$[\d,]+(?:\.\d+)?/g) ?? []).toEqual(["$100.00"]);
      // No word boundary before the code: the card's text runs together as
      // `$100.00EUR 40.00`, and a `\b` there never matches.
      expect(spoken.match(/[A-Z]{3} -?[\d,]+(?:\.\d+)?/g) ?? []).toEqual([
        "EUR 40.00",
      ]);
    });
  });

  describe("given a window billed only in a currency nobody converted", () => {
    /** @scenario "A currency nobody converted still totals in the currency it was billed in" */
    it("shows the euro total on its own and leaves the dollar figure withheld", () => {
      harness.query = {
        data: summaryFixture({
          billed: {
            // Every cell holds an amount, in euros, and none was converted:
            // no dollar figure, and NOTHING unpriced. The lane still
            // reported — the money totals in the currency it was billed in.
            amountUsd: null,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [
              { currencyCode: "EUR", amount: 40, cellsWithoutAmount: 0 },
            ],
          },
          // The other lane is empty too, so this passes only if the euro
          // total alone is enough to count the bill as reported. With a
          // dollar figure beside it the screen would show the lanes anyway
          // and the regression — a euro-only bill reading as no bill at all
          // — would slip through.
          gateway: {
            amountUsd: null,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [],
          },
        }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      // The lanes render: this is a real bill, not an account with nothing
      // recorded against it.
      const lane = screen.getByTestId("cost-lane-billed");
      const spoken = lane.textContent ?? "";
      // The euros total in euros, and the dollar figure is untouched by
      // them: no dollar amount is shown at all, and no rate produced one.
      expect(spoken.match(/[A-Z]{3} -?[\d,]+(?:\.\d+)?/g) ?? []).toEqual([
        "EUR 40.00",
      ]);
      expect(spoken.match(/-?\$[\d,]+(?:\.\d+)?/g) ?? []).toEqual([]);
    });
  });

  describe("given the read side sent an Azure billing note", () => {
    // These render the actual wiring — DTO field to page to panel — which the
    // note's decision and sentence unit tests cannot see: deleting the
    // `laneNote` pass-through in `costs.tsx` or the render in
    // `CostLanePanel.tsx` fails here and nowhere else.
    const withNote = (azureBilling: string | null) => {
      harness.query = {
        data: summaryFixture({
          azureBilling,
          billed: {
            amountUsd: null,
            cellsWithoutAmount: 0,
            currenciesWithoutUsdAmount: [],
            currencyTotals: [],
          },
        }),
        isLoading: false,
        isError: false,
      };
    };

    /**
     * What the billed lane's (i) says, opened.
     *
     * The lane's sentence and whatever the read side added about it moved off
     * the face of the card and behind the (i) beside its title: three cards
     * sit in a row and each closed on a paragraph, which set the row's height
     * by the longest of them. The popover portals out of the card, so it is
     * found on the document rather than inside the lane.
     */
    const billedLaneInfo = () => {
      fireEvent.click(screen.getByTestId("cost-lane-billed-about"));
      const body = document.querySelector<HTMLElement>(
        '[data-scope="popover"][data-part="content"]',
      );
      if (body === null) throw new Error("the lane's (i) did not open");
      return body;
    };

    /** @scenario "A tenant that declared prepaid packs is told the bill cannot show them" */
    it("explains a declared-prepaid tenant's empty bill on the billed lane", () => {
      withNote("prepaid_declared");
      renderScreen();

      expect(billedLaneInfo()).toHaveTextContent(
        /prepaid.*never appear.*bill/i,
      );
    });

    /** @scenario "A tenant that declared nothing is never told it is prepaid" */
    it("says the bill was read and holds nothing, without mentioning prepaid", () => {
      withNote("no_spend_recorded");
      renderScreen();

      const info = billedLaneInfo();
      expect(info).toHaveTextContent(/was read/i);
      expect(info).toHaveTextContent(/no .*charges/i);
      // The word must be absent from the card AND from what its (i) says: a
      // tenant that declared nothing being told about prepaid packs is the
      // defect, wherever the sentence happens to live.
      for (const readable of [
        ...readableStrings(screen.getByTestId("cost-lane-billed")),
        ...readableStrings(info),
      ]) {
        expect(readable).not.toMatch(/prepaid/i);
      }
    });

    /** @scenario "A declared-prepaid tenant whose bill has amounts sees the amounts" */
    it("renders the figures with no note when the read side sent none", () => {
      // The read side withholds the note whenever the bill holds amounts;
      // the screen's half of that contract is to add nothing to what the (i)
      // already says about the lane itself.
      harness.query = {
        data: summaryFixture({ azureBilling: null }),
        isLoading: false,
        isError: false,
      };
      renderScreen();

      const billed = screen.getByTestId("cost-lane-billed");
      expect(within(billed).getByText("$123.45")).toBeInTheDocument();
      expect(billedLaneInfo()).toHaveTextContent(
        "Provider-reported costs recorded for this period.",
      );
      expect(billedLaneInfo()).not.toHaveTextContent(/could not be read/i);
    });

    it("reports a failed read as missing data on the lane", () => {
      withNote("billing_read_failed");
      renderScreen();

      expect(billedLaneInfo()).toHaveTextContent(/could not be read/i);
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

  describe("given a window that holds no days", () => {
    // The full-width lane chart that used to sit under the lanes is gone, and
    // its empty state with it. The lanes themselves are what a reader is left
    // with, so they are what has to survive a window with no series behind it
    // — rendering figures, not disappearing, and not drawing a zero.
    it("still renders the lanes rather than emptying the screen", () => {
      harness.query = {
        data: summaryFixture({ series: [] }),
        isLoading: false,
        isError: false,
      };

      renderScreen();

      expect(screen.getByTestId("cost-lane-billed")).toBeInTheDocument();
      expect(screen.getByTestId("cost-lane-gateway")).toBeInTheDocument();
    });
  });

  describe("given a source whose pulls have been failing", () => {
    /**
     * THE SCREEN NO LONGER SAYS SO, by decision rather than by regression.
     * Two warning banners stood above the lanes — this one, and one for days
     * read while cost recording was off — and both were removed at the
     * product owner's direction: the screen opens with figures rather than
     * with caveats about them, and the source pages carry the same fact
     * beside the source a reader would have to visit to act on it.
     *
     * The read still reports it (see the unit scenarios under the summary's
     * own Rule), so this holds the screen's half: it draws neither banner,
     * and it does not fall over on a summary that carries one.
     */
    it("draws no warning banner over the lanes", () => {
      harness.query = {
        data: summaryFixture({
          staleSources: {
            oldestLastSuccessIso: "2026-08-20T09:00:00.000Z",
            sourceNames: ["Azure Billing"],
          },
        }),
        isLoading: false,
        isError: false,
      };

      renderScreen();

      expect(
        screen.queryByTestId("cost-stale-sources"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("cost-unpriced-window"),
      ).not.toBeInTheDocument();
      // The lanes still render, which is what makes this a removal rather
      // than a screen that fell over on the field it stopped reading.
      expect(screen.getByTestId("cost-lane-billed")).toBeInTheDocument();
    });
  });

  describe("given the section's no-native-select rule", () => {
    // The rule the section rulebook calls its hardest, checked on this page
    // rather than on the filter row alone.
    //
    // Both states, because they render different controls: with figures the
    // page draws its charts and their legends, and with nothing read it draws
    // the empty panels and their links. A rule proved against one of those
    // says nothing about the other.
    //
    // The assertion runs against `document.body`, not the render container.
    // A chip's menu portals out of the container when it opens, so a native
    // select inside one would sit outside anything `render` hands back — the
    // rule is about the page, and the page is the document.

    /** @scenario "No governance page renders a native select" */
    it("contains no native select element, with data and with none", () => {
      renderScreen();
      expect(findNativeSelects(document.body)).toHaveLength(0);

      cleanup();

      // Nothing read at all: the summary answers undefined and every
      // breakdown is already mocked to do the same.
      harness.query = { data: undefined, isLoading: false, isError: false };
      renderScreen();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});
