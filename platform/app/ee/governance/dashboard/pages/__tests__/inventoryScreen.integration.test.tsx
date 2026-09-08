// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Inventory page, mounted through its real guard stack.
 *
 * Only the boundaries are mocked — the layout chrome, the plan, the feature
 * flag and the tRPC client. The permission decision is NOT: `hasAnyPermission`
 * runs the real role bag, so a grant missing from it fails these tests rather
 * than shipping a screen nobody can open.
 *
 * The page is the right level for these assertions rather than the panes: two
 * of the rules under test — where the actions sit, and that no native select
 * is anywhere on screen — are claims about the whole screen, and a pane test
 * can see neither the header nor the drawers.
 *
 * Specs:
 *   - specs/ai-governance/dashboard/inventory-catalog.feature
 *   - specs/ai-governance/dashboard/inventory-environments.feature
 *   - specs/ai-governance/dashboard/governance-ui-controls.feature
 */
import { Button, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findNativeSelects } from "~/components/governance/filters";
import { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";
import {
  getOrganizationRolePermissions,
  hasPermissionWithHierarchy,
} from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  /** What `ingestionSources.list` answers. */
  sources: {
    data: undefined as unknown,
    isLoading: false,
    error: null as unknown,
  },
  /** What `activityMonitor.ingestionSourcesHealth` answers. */
  health: { data: undefined as unknown },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => {
  const holds = (permission: string) =>
    hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({
    isEnterprise: true,
    isLoading: false,
    activePlan: undefined,
  }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/NotFoundScene", () => ({
  NotFoundScene: () => <div>this page does not exist</div>,
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div>loading</div>,
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/api", () => {
  const mutation = () => ({
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      variables: undefined,
      data: undefined,
      error: null,
      reset: vi.fn(),
    }),
  });
  return {
    api: {
      useUtils: () => ({
        ingestionSources: { list: { invalidate: vi.fn() } },
      }),
      ingestionSources: {
        list: { useQuery: () => harness.sources },
        create: mutation(),
        update: mutation(),
        rotateSecret: mutation(),
        archive: mutation(),
        ottlStarter: {
          useQuery: () => ({ data: undefined, isLoading: false, error: null }),
        },
        validateOttl: mutation(),
      },
      activityMonitor: {
        ingestionSourcesHealth: { useQuery: () => harness.health },
      },
    },
  };
});

import { AddIngestionSourceMenu } from "../../components/AddIngestionSourceMenu";
import InventoryPage from "../inventory";

/** The real org-admin bag, not a hand-written list that could drift from it. */
const ORG_ADMIN_PERMISSIONS = getOrganizationRolePermissions("ADMIN").slice();

/**
 * A Genie source and a Copilot Studio one: between them they cover a card with
 * a licence read, a card without, and two different environment addresses.
 */
const CONNECTED_SOURCES = [
  {
    id: "src-genie",
    organizationId: "org-1",
    teamId: null,
    name: "Warehouse questions",
    description: null,
    sourceType: "databricks_genie",
    parserConfig: { workspaceUrl: "https://example-workspace.cloud.test/" },
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    traceProjectId: null,
    traceProjectArchived: false,
    archivedAt: null,
    createdAt: new Date("2026-04-02T10:00:00.000Z"),
    updatedAt: new Date("2026-04-02T10:00:00.000Z"),
    createdById: null,
    hasPollerCursor: false,
    pullSchedule: null,
  },
  {
    id: "src-copilot",
    organizationId: "org-1",
    teamId: null,
    name: "Assistant transcripts",
    description: null,
    sourceType: "copilot_studio_dataverse",
    parserConfig: {
      environmentUrl: "https://example-env.crm.test",
      readSeats: true,
    },
    status: "active",
    errorCount: 0,
    lastSuccessAt: null,
    lastEventAt: null,
    traceProjectId: null,
    traceProjectArchived: false,
    archivedAt: null,
    createdAt: new Date("2026-05-11T08:30:00.000Z"),
    updatedAt: new Date("2026-05-11T08:30:00.000Z"),
    createdById: null,
    hasPollerCursor: false,
    pullSchedule: null,
  },
];

function renderScreen() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance/inventory"]}>
        <InventoryPage />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

/**
 * Buttons of known variant and size, rendered beside the page so the header's
 * real buttons can be compared against them.
 *
 * Chakra emits an opaque hashed class name, so there is no readable "solid" to
 * assert on. Hard-coding the hash would pass today and break on the next
 * Chakra bump for no reason anyone could diagnose. Rendering a reference of a
 * known variant and comparing class names asserts the thing the rule is about
 * and survives the bump.
 *
 * The solid reference carries the section's orange rather than a plain solid,
 * which is grey. Comparing against grey would let this page drift away from
 * the rest of the section while still reporting green.
 */
function ButtonReferences() {
  return (
    <>
      <Button size="sm" variant="outline">
        reference outline small
      </Button>
      <Button size="sm" variant="ghost">
        reference ghost small
      </Button>
      {/* Branded, like the solid reference and for the same reason: the kit
          draws the pressed toggle `subtle` in orange, and the palette is part
          of the class Chakra emits, so a bare subtle reference never matches. */}
      <Button size="sm" variant="subtle" colorPalette="orange">
        reference subtle small
      </Button>
      <Button size="sm" colorPalette="orange">
        reference solid small
      </Button>
      {/* Add tool is not a bare button: it is this menu's trigger, and the
          trigger composition adds a class and its own emitted style. Comparing
          it against a bare solid button fails on the wrapper rather than on
          the variant, which would be a false alarm. So the reference wears the
          same wrapper, and the comparison stays about the button. */}
      <AddIngestionSourceMenu isEnterprise onPick={() => undefined}>
        <Button size="sm" colorPalette="orange">
          reference solid small trigger
        </Button>
      </AddIngestionSourceMenu>
    </>
  );
}

function renderScreenWithReferences() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance/inventory"]}>
        <InventoryPage />
        <ButtonReferences />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

/**
 * Switch panes and wait for the switch to land.
 *
 * The selected tab lives in the address (`?tab=`), so picking one is a
 * navigation, and react-router runs navigations inside a transition.
 * `userEvent.click` flushes its own act() but not the deferred transition, so
 * a synchronous query straight after the click reads the OLD pane and reports
 * a working tab strip as broken. Waiting for the tab to report itself selected
 * keeps these tests about the page rather than about React's scheduler.
 */
async function openTab(name: RegExp) {
  const tab = screen.getByRole("tab", { name });
  await userEvent.click(tab);
  await waitFor(() => expect(tab).toHaveAttribute("aria-selected", "true"));
}

beforeEach(() => {
  harness.permissions = ORG_ADMIN_PERMISSIONS;
  harness.sources = { data: [], isLoading: false, error: null };
  harness.health = { data: undefined };
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * An organization with no tools AND the samples turned off.
 *
 * Both halves are needed to see a real empty pane: with nothing connected the
 * page offers sample data by itself, so an empty source list alone renders
 * eight invented cards rather than the empty state. This is the reader who
 * pressed "Hide sample data" and is looking at their actual, empty catalog.
 */
function emptyWithSamplesOff() {
  harness.sources = { data: [], isLoading: false, error: null };
  window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
}

/** The screen with two tools connected, so sample mode stays off by itself. */
function connectTools() {
  harness.sources = { data: CONNECTED_SOURCES, isLoading: false, error: null };
  harness.health = { data: [{ id: "src-genie", eventsLast24h: 1234 }] };
}

describe("given an admin on the Inventory page", () => {
  describe("when the tab strip renders", () => {
    /** @scenario "The Environments tab sits between Catalog and Sources" */
    it("reads Catalog, Environments and Sources, with no Approvals or Anomaly rules", () => {
      renderScreen();
      const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabs.map((label) => label?.replace(/\d+$/, "").trim())).toEqual([
        "Catalog",
        "Environments",
        "Sources",
      ]);
      expect(screen.queryByRole("tab", { name: /approvals/i })).toBeNull();
      // A rule is a standing instruction about what to watch for, not a thing
      // the organization runs, so it is not part of an inventory. Asserted by
      // absence rather than left to the list above, because a tab appended
      // after Sources would otherwise only fail the equality on its way past.
      expect(screen.queryByRole("tab", { name: /anomaly/i })).toBeNull();
    });

    /** @scenario "The tab says how many tools are in the catalog" */
    it("carries the catalog count on the Catalog tab", () => {
      connectTools();
      renderScreen();
      expect(screen.getAllByRole("tab")[0]?.textContent).toContain("2");
    });
  });

  describe("when the page renders with tools connected", () => {
    beforeEach(connectTools);

    // The rulebook's badge scenario has two clauses and the second is the one
    // that protects the reader: a badge on every card, sample or not, would be
    // decoration rather than a warning. The sample half is asserted in the
    // sample-mode block below; this is the measured half, and the pair of them
    // is what the scenario actually claims.
    /** @scenario "Every invented panel is marked, by a badge or by a banner above it" */
    it("leaves the badge off cards built from real connected tools", () => {
      renderScreen();
      const cards = screen
        .getByTestId("tool-catalog-cards")
        .querySelectorAll("[data-testid^='tool-card-']");
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.textContent).not.toMatch(/sample/i);
      }
    });

    /** @scenario "A registered tool is a card carrying its name and its vendor" */
    it("shows a card per connected tool with its name and vendor", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-src-genie");
      expect(within(card).getByText("Warehouse questions")).toBeInTheDocument();
      expect(
        within(card).getByText(/Databricks AI\/BI Genie/),
      ).toBeInTheDocument();
    });

    /** @scenario "The one row this branch measures carries its real figure" */
    it("shows the measured event count under the window it was counted over", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-src-genie");
      expect(within(card).getByText("Events · 24 hours")).toBeInTheDocument();
      expect(within(card).getByText("1,234")).toBeInTheDocument();
    });

    /** @scenario "A row nothing measures shows a dash naming what would fill it" */
    it("draws a dash naming the missing read for every unmeasured row", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-src-genie");
      const dashes = within(card).getAllByLabelText(/not measured\./);
      // Nine of the ten rows have no read keyed by tool on this branch. The
      // count is asserted rather than "more than none" so a card that quietly
      // stopped drawing dashes at all cannot pass this.
      expect(dashes).toHaveLength(9);
      for (const dash of dashes) {
        expect(dash.getAttribute("aria-label")).toMatch(/not measured\. .+\.$/);
      }
      // A row we cannot read is never drawn as a zero.
      expect(within(card).queryByText("0")).toBeNull();
    });

    /** @scenario "An environment a source points at is listed without being created" */
    it("lists a discovered environment badged with the source it came from", async () => {
      renderScreen();
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(
        within(table).getByText("example-env.crm.test"),
      ).toBeInTheDocument();
      expect(
        within(table).getByText("Discovered from Assistant transcripts"),
      ).toBeInTheDocument();
    });

    /** @scenario "A discovered row says nobody created it" */
    it("says a discovered environment was discovered automatically", async () => {
      renderScreen();
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(
        within(table).getAllByText("Discovered automatically").length,
      ).toBeGreaterThan(0);
    });

    /** @scenario "Sample environments replace discovered environments until disabled" */
    it("replaces discovered environments and restores them when samples are off", async () => {
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(within(table).getByText("Production")).toBeInTheDocument();
      expect(within(table).queryByText("example-env.crm.test")).toBeNull();
      await userEvent.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );
      expect(
        within(table).getByText("example-env.crm.test"),
      ).toBeInTheDocument();
      expect(within(table).queryByText("Production")).toBeNull();
    });

    /** @scenario "Sample sources replace real sources without offering real actions" */
    it("replaces real sources with read-only samples until disabled", async () => {
      renderScreen();
      await openTab(/Sources/);
      expect(screen.getByTestId("source-row-src-genie")).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      expect(screen.queryByTestId("source-row-src-genie")).toBeNull();
      const rows = screen.getAllByTestId(/^source-row-/);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(within(row).queryByRole("link")).toBeNull();
        expect(within(row).queryByRole("button")).toBeNull();
      }
      await userEvent.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );
      expect(screen.getByTestId("source-row-src-genie")).toBeInTheDocument();
    });

    /** @scenario "The catalog is offered as a grid or as a list" */
    it("switches the cards between a grid and a single column", async () => {
      renderScreen();
      expect(screen.getByTestId("tool-catalog-cards")).toHaveAttribute(
        "data-layout",
        "grid",
      );
      await userEvent.click(screen.getByRole("radio", { name: /List/ }));
      await waitFor(() =>
        expect(screen.getByTestId("tool-catalog-cards")).toHaveAttribute(
          "data-layout",
          "list",
        ),
      );
    });

    /** @scenario "Sample mode replaces the cards rather than filling them in" */
    it("shows the sample tools and no card built from a real source", async () => {
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      expect(
        await screen.findByTestId("tool-card-sample-claude-code"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("tool-card-src-genie")).toBeNull();
    });
  });

  describe("when the catalog is in view", () => {
    /** @scenario "Adding a tool opens the same menu that adds a source" */
    it("offers the Add source menu's own tools behind Add tool", async () => {
      renderScreen();
      await userEvent.click(
        screen.getAllByRole("button", { name: /Add tool/ })[0]!,
      );
      expect(
        await screen.findByRole("menuitem", {
          name: /Databricks AI\/BI Genie/,
        }),
      ).toBeInTheDocument();
    });

    /** @scenario "The tool tiles and the starter pack are gone from this page" */
    it("renders no tile editor, tile section or starter pack", () => {
      renderScreen();
      const page = document.body.textContent ?? "";
      expect(page).not.toMatch(/starter pack/i);
      expect(page).not.toMatch(/tool tiles/i);
      expect(page).not.toMatch(/ingestion templates/i);
      expect(page).not.toMatch(/add tile/i);
      expect(page).not.toMatch(/coding assistants/i);
    });
  });

  describe("when sample mode is explicitly enabled", () => {
    beforeEach(() => window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true"));
    /** @scenario "Every sample card says it is a sample" */
    /** @scenario "Every invented panel is marked, by a badge or by a banner above it" */
    it("badges every card as a sample", () => {
      renderScreen();
      const cards = screen
        .getByTestId("tool-catalog-cards")
        .querySelectorAll("[data-testid^='tool-card-']");
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.textContent).toContain("sample");
      }
    });

    /** @scenario "A tool billed on consumption is not shown as having no seats" */
    it("says a consumption-billed tool has no seats rather than zero", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-databricks-genie");
      expect(
        within(card).getByText("no seats, billed on consumption"),
      ).toBeInTheDocument();
    });

    // Nine digits against a short label cannot be compared card to card.
    /** @scenario "A count of a million or more is shortened on the card" */
    it("shortens a nine-digit token count", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-claude-code");
      expect(within(card).getByText("412.9M")).toBeInTheDocument();
      expect(within(card).queryByText("412,900,000")).toBeNull();
    });

    /** @scenario "A shortened count keeps its exact value on hover" */
    it("still carries the exact token count as the row's accessible name", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-claude-code");
      expect(
        within(card).getByLabelText("Tokens · 30 days: 412,900,000"),
      ).toBeInTheDocument();
    });

    /** @scenario "A count below a million is left exact and grouped" */
    it("leaves a five-digit event count in full", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-github-copilot");
      expect(within(card).getByText("22,180")).toBeInTheDocument();
    });

    /** @scenario "Money and prose rows are never shortened" */
    it("leaves money and the seat sentence exactly as written", () => {
      renderScreen();
      const card = screen.getByTestId("tool-card-sample-claude-code");
      // Money reads fine at four digits, and shortening it would be worse:
      // "$1.1K" hides the hundreds a renewal conversation turns on.
      expect(within(card).getByText("$1,140")).toBeInTheDocument();
      expect(within(card).getByText("44 of 60 active")).toBeInTheDocument();
    });

    /** @scenario "A failed read raises no alert while sample mode is on" */
    it("raises no error alert when the source read failed", async () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      harness.sources = {
        data: undefined,
        isLoading: false,
        error: new Error("read failed"),
      };
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "See sample data" }),
      );
      await openTab(/Sources/);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    /** @scenario "Sample environments fill an empty table and say they are samples" */
    it("fills an empty environments table with badged sample rows", async () => {
      renderScreen();
      await openTab(/Environments/);
      const table = await screen.findByTestId("environments-table");
      expect(within(table).getByText("Production")).toBeInTheDocument();
      expect(within(table).getAllByText("sample").length).toBeGreaterThan(0);
    });
  });

  describe("when nothing is connected and samples are turned off", () => {
    /** @scenario "An organization with no environments is told where they come from" */
    it("says where environments come from instead of listing none", async () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderScreen();
      await userEvent.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );
      await openTab(/Environments/);
      expect(
        await screen.findByText(/appear here once a source points at one/i),
      ).toBeInTheDocument();
    });
  });

  describe("when an admin adds an environment", () => {
    /** Open the Environments pane and its add dialog. */
    async function openAddEnvironment() {
      renderScreen();
      await openTab(/Environments/);
      await userEvent.click(
        screen.getByRole("button", { name: /Add environment/ }),
      );
      return await screen.findByRole("dialog");
    }

    /** @scenario "The add dialog asks for a name and a description" */
    it("asks for a name and a description and refuses an empty name", async () => {
      const dialog = await openAddEnvironment();
      expect(within(dialog).getByText("Name")).toBeInTheDocument();
      expect(within(dialog).getByText("Description")).toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Add environment" }),
      ).toBeDisabled();
    });

    /** @scenario "The add dialog says the environment will not be stored" */
    it("says the environment is not stored and is gone on reload", async () => {
      const dialog = await openAddEnvironment();
      expect(
        within(dialog).getByText(/not stored yet[\s\S]*gone when you reload/i),
      ).toBeInTheDocument();
    });

    /** @scenario "An added environment joins the table for this sitting" */
    it("puts the added environment in the table", async () => {
      const dialog = await openAddEnvironment();
      await userEvent.type(
        within(dialog).getByPlaceholderText("Production"),
        "Blue ring",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Add environment" }),
      );
      const table = await screen.findByTestId("environments-table");
      await waitFor(() =>
        expect(within(table).getByText("Blue ring")).toBeInTheDocument(),
      );
    });
  });

  describe("when the section's shared UI rules are checked", () => {
    /*
     * Position is asserted structurally rather than by pixel: the actions are
     * the last child of the header row, which is what puts them at its right
     * end under `justify="space-between"`, and jsdom lays nothing out.
     */
    /** @scenario "Primary page actions sit top-right in the page header" */
    it("puts the page actions at the right of the header, small, one solid", async () => {
      connectTools();
      renderScreenWithReferences();
      const heading = screen.getByRole("heading", { name: "Inventory" });
      const headerRow = heading.closest("div")?.parentElement;
      expect(headerRow).not.toBeNull();
      const actions = headerRow?.lastElementChild;
      const sampleToggle = screen.getByRole("button", {
        name: "See sample data",
      });
      const addTool = screen.getAllByRole("button", { name: /Add tool/ })[0]!;
      expect(actions?.contains(sampleToggle)).toBe(true);
      expect(actions?.contains(addTool)).toBe(true);

      const ghostSmall = screen.getByText("reference ghost small").className;
      const subtleSmall = screen.getByText("reference subtle small").className;
      const solidSmall = screen.getByText("reference solid small").className;
      const solidSmallTrigger = screen.getByText(
        "reference solid small trigger",
      ).className;

      // The old assertion here was `addTool.className !== sampleToggle.className`,
      // which is satisfied by any two buttons that differ at all. A grey Add
      // tool passed it exactly as happily as the solid orange one the page
      // actually renders, so it could not catch the drift it was written for.
      //
      // Adding a tool is the only action here that registers something of the
      // organization's own, so it is the solid one.
      expect(addTool.className).toBe(solidSmallTrigger);
      // Ghost rather than outline: the toggle changes what the page shows
      // rather than anything about the organization.
      expect(sampleToggle.className).toBe(ghostSmall);

      // Exactly one solid, not "at most one". A header where nothing is solid
      // reads as a header with no primary action.
      const headerButtons = actions
        ? Array.from(actions.querySelectorAll("button"))
        : [];
      expect(
        headerButtons.filter(
          (button) =>
            button.className === solidSmall ||
            button.className === solidSmallTrigger,
        ),
      ).toHaveLength(1);

      // Pressed, the kit draws the toggle subtle rather than ghost, so that a
      // page showing invented figures says so in the control that caused it.
      // Asserting only the resting state would leave the louder of the two
      // states unchecked, which is the state that matters.
      await userEvent.click(sampleToggle);
      const pressedToggle = await screen.findByRole("button", {
        name: "Hide sample data",
      });
      expect(pressedToggle.className).toBe(subtleSmall);
      // Never solid in either state. Solid is reserved for the action that
      // creates something of the organization's own, and looking at invented
      // data is not that.
      expect(pressedToggle.className).not.toBe(solidSmall);
      expect(ghostSmall).not.toBe(subtleSmall);
    });

    // Swept across the WHOLE screen, not inside the header. Sweeping only the
    // header is what would have missed the defect this rule was written for:
    // the second control was down in the sources table's own header, and every
    // assertion scoped to the page header agreed the page was fine.
    //
    // Label AND weight, because the defect was both. A solid "Add tool" up top
    // beside an outline "Add source" below gave one flow two names and two
    // weights. Asserting only the count would forbid an empty state from
    // repeating the header's own action, which the shared empty state is built
    // to allow and which Agents does.
    /** @scenario "A page offers one create flow, under one label, from its header" */
    it("gives the create flow one label and one weight on each pane, from the header", async () => {
      connectTools();
      renderScreen();

      const createControls = () =>
        screen.queryAllByRole("button", { name: /Add (tool|source)/ });
      const heading = screen.getByRole("heading", { name: "Inventory" });
      const headerRow = heading.closest("div")?.parentElement;

      const assertOneDoor = (expectedLabel: string) => {
        const controls = createControls();
        expect(controls.length).toBeGreaterThan(0);
        for (const control of controls) {
          expect(control).toHaveTextContent(expectedLabel);
        }
        // One weight: every control opening this flow renders identically.
        const weights = new Set(controls.map((c) => c.className));
        expect(weights.size).toBe(1);
        // And the flow is reachable from the header, not only from the content.
        expect(controls.some((c) => headerRow?.contains(c))).toBe(true);
      };

      assertOneDoor("Add tool");

      await openTab(/Sources/);

      // The sources table used to add its own, differently-worded control, so
      // this is the pane the rule exists for.
      assertOneDoor("Add source");
    });

    // The catalog with nothing in it, and the samples turned off, which is the
    // only combination that shows a reader their own empty catalog.
    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("draws the shared empty state on an empty catalog, glyph, headline and sentence", async () => {
      emptyWithSamplesOff();
      renderScreen();

      const empty = screen.getByTestId("tool-catalog-empty");
      expect(
        within(empty).getByText("No tools registered yet"),
      ).toBeInTheDocument();
      // The sentence says what fills the catalog. Asserted because a headline
      // alone is the old grey-box empty state wearing a bigger font.
      expect(within(empty).getByText(/joins the catalog/)).toBeInTheDocument();
      // The glyph. The scenario names it, and a shared empty state that
      // silently dropped it would still pass on headline and sentence alone.
      expect(empty.querySelector("svg")).not.toBeNull();
      // Never the dashed box this replaced. Dashes read as a drop target or a
      // component that failed to arrive, which is what the owner reported.
      expect(empty).not.toHaveStyle({ borderStyle: "dashed" });
      // The empty state offers the way out, and offers it under the HEADER'S
      // label rather than a new one. The sentence used to name the button in
      // prose instead ("with Add tool, above"), which pointed at a control by
      // a name nothing checked: rename the header and the sentence lies, and
      // no rule about controls can catch a stale sentence.
      const inside = within(empty).getByRole("button", { name: /Add tool/ });
      const header = screen
        .getByRole("heading", { name: "Inventory" })
        .closest("div")?.parentElement;
      const inHeader = within(header as HTMLElement).getByRole("button", {
        name: /Add tool/,
      });
      expect(inside).not.toBe(inHeader);
      // Same label and same weight.
      expect(inside.className).toBe(inHeader.className);
      // And same FLOW, which label and weight alone do not prove: two
      // identically-drawn buttons can still lead to different places, and that
      // would be the original defect wearing a matching coat. Followed all the
      // way to the composer, because both controls own a menu and asserting
      // only that a menu opened would accept two menus onto two flows.
      //
      // Scoped to the menu that this press opened, not to the screen: both
      // triggers mount their own menu content, so a page-level query for a
      // menu item finds two and cannot say which trigger opened one. The
      // trigger reporting itself expanded is what ties the open menu to it.
      await userEvent.click(inside);
      expect(inside).toHaveAttribute("aria-expanded", "true");
      expect(inHeader).toHaveAttribute("aria-expanded", "false");
      const menus = await screen.findAllByRole("menu");
      const open = menus.filter((m) => m.dataset.state === "open");
      expect(open).toHaveLength(1);
      await userEvent.click(
        within(open[0] as HTMLElement).getByRole("menuitem", {
          name: /Anthropic Admin API/,
        }),
      );
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    // A reader who cannot create must not be told to press a button that is
    // not on their screen. The sentence changes with the grant, which is the
    // only part of the empty state that may.
    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("does not point a read-only viewer at a create control they cannot see", () => {
      harness.permissions = [
        "organization:view",
        "governance:view",
        "ingestionSources:view",
      ];
      emptyWithSamplesOff();
      renderScreen();

      const empty = screen.getByTestId("tool-catalog-empty");
      expect(
        within(empty).getByText(/someone connects it/),
      ).toBeInTheDocument();
      // Neither the sentence nor the action offers a create. The empty state
      // drops its action with the grant, so a viewer gets an explanation and
      // no button, rather than a button that would fail on press.
      expect(within(empty).queryByRole("button")).toBeNull();
      expect(screen.queryByRole("button", { name: /Add tool/ })).toBeNull();
    });

    /*
     * Every pane, and both drawers that carry choice controls.
     *
     * The narrow version of this test opened one drawer on one source type and
     * proved almost nothing: "Custom S3 audit log" has no pull adapter, so the
     * cadence field never mounted, and the anomaly-rule composer was never
     * reached at all. Four native selects and a Chakra NativeSelect survived
     * underneath a passing assertion. So this walks every tab and opens the
     * drawer on a PULL-BASED type, which is the only way the cadence field
     * renders.
     *
     * The composer's own four selects left this page with the Anomaly rules
     * tab. They are still swept, in the component test beside the tab itself:
     * ee/governance/dashboard/components/__tests__/anomalyRulesComposer.integration.test.tsx.
     */
    /** @scenario "No governance page renders a native select" */
    it("renders no native select on any tab, empty or full", async () => {
      const { unmount } = renderScreen();
      for (const tab of [/Environments/, /Sources/, /Catalog/]) {
        await openTab(tab);
        expect(findNativeSelects(document.body)).toHaveLength(0);
      }
      unmount();

      connectTools();
      renderScreen();
      for (const tab of [/Environments/, /Sources/]) {
        await openTab(tab);
        expect(findNativeSelects(document.body)).toHaveLength(0);
      }
    });

    /*
     * `anthropic_admin` is chosen deliberately: it has a pull adapter, so the
     * cadence field mounts. A push-only type skips it and the assertion goes
     * quiet again.
     */
    /** @scenario "No governance page renders a native select" */
    it("renders no native select in the source drawer, cadence field and all", async () => {
      connectTools();
      renderScreen();
      await userEvent.click(
        screen.getAllByRole("button", { name: /Add tool/ })[0]!,
      );
      await userEvent.click(
        await screen.findByRole("menuitem", { name: /Anthropic Admin API/ }),
      );
      await screen.findByRole("dialog");
      const advanced = screen.queryByRole("button", { name: /Advanced/ });
      if (advanced) await userEvent.click(advanced);
      // Prove the cadence field is actually on screen before declaring it
      // native-free. Without this the test passes just as loudly on a drawer
      // that never rendered the control, which is how the narrow version of
      // this assertion went green over five native selects.
      expect(
        screen.getByRole("combobox", { name: "Frequency" }),
      ).toBeInTheDocument();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});
