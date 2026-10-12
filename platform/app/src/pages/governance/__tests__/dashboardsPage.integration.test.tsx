/**
 * @vitest-environment jsdom
 *
 * The governance Dashboards page, mounted through its real guards. What is
 * under test is the shape the page promises: the same release gate Costs
 * already uses, exactly four cost widgets on the product's own grid, charts
 * drawn only from invented figures, and — the hard rule — nothing on the page
 * that could save anything or reach a row.
 *
 * Spec: specs/governance/governance-dashboards.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChartGridPlacement } from "~/server/analytics/chartGrid";
import { CHART_GRID_COLUMNS } from "~/server/analytics/chartGrid";
import {
  getOrganizationRolePermissions,
  hasPermissionWithHierarchy,
} from "~/server/api/rbac";

const harness = vi.hoisted(() => ({
  permissions: [] as string[],
  flagEnabled: true,
  colorMode: "light" as "light" | "dark",
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
  useFeatureFlag: (flag: string) => ({
    // The section-wide flag stays on so the tests are about THIS flag.
    enabled:
      flag === "release_ui_governance_billed_cost_enabled"
        ? harness.flagEnabled
        : true,
    isLoading: false,
  }),
}));
/**
 * The reader's colour mode, driven from the harness. Only the hook is
 * replaced — everything else in the module is the design system's own tokens,
 * which the page renders against.
 */
vi.mock("~/components/ui/color-mode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/components/ui/color-mode")>()),
  useColorMode: () => ({
    colorMode: harness.colorMode,
    setColorMode: () => undefined,
    toggleColorMode: () => undefined,
  }),
}));
vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
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

/**
 * Every chart the page mounts, with the three things it was handed. The frame
 * itself is an `iframe` running author code over a MessagePort — none of which
 * jsdom can run — so what is asserted here is the WIRING: how many frames were
 * mounted, what each was told about its surroundings, and what its query
 * executor answers. That is the whole of the page's contract with a chart.
 */
interface RecordedFrame {
  code: string;
  executeQuery: (args: {
    queryName: string;
    params: Record<string, unknown>;
    signal: AbortSignal;
  }) => Promise<{ columns: readonly { name: string; type: string }[] }>;
  dashboardContext: Record<string, unknown>;
}
const frameProps = vi.hoisted(() => [] as unknown[]);
vi.mock("~/features/custom-chart-playground/SandboxedChartFrame", () => ({
  SandboxedChartFrame: (props: unknown) => {
    frameProps.push(props);
    return <div data-testid="chart-frame" />;
  },
}));

/**
 * The real editor pane is Monaco behind a lazy import, which jsdom neither
 * loads nor lays out — a page rendered against it would show no statement at
 * all and every assertion about one below would pass for the wrong reason. The
 * stub is a plain box with the same value/onChange contract, which is the whole
 * of what this page depends on.
 */
vi.mock("~/features/custom-chart-playground/DashboardWidgetCodeEditor", () => ({
  DashboardWidgetCodeEditor: ({
    language,
    value,
    onChange,
  }: {
    language: string;
    value: string;
    onChange: (next: string) => void;
  }) => (
    // Named by language: the editor mounts one pane for the widget's file and
    // one for each statement, and an assertion that could not tell them apart
    // would read the wrong one.
    <textarea
      data-testid={`widget-editor-${language}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

/**
 * The real grid measures its container through a `ResizeObserver` and renders
 * nothing until it has a width, neither of which jsdom provides — so a page
 * rendered against the real one would show no cards at all and every absence
 * below would pass for the wrong reason. The stub renders each card and keeps
 * the placements, which is also what makes the layout assertion possible.
 */
const gridPlacements = vi.hoisted(() => [] as unknown[]);
/**
 * The placements of the LAST render only. `gridPlacements` accumulates across
 * renders, which answers "what was the page authored with"; a drag is only
 * visible in what the grid is given the next time around.
 */
const latestPlacements = vi.hoisted(() => [] as unknown[]);
vi.mock("~/components/analytics/reports/ChartGrid", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/components/analytics/reports/ChartGrid")
  >()),
  ChartGrid: ({
    placements,
    onPlacementsCommit,
    renderCard,
  }: {
    placements: ChartGridPlacement[];
    onPlacementsCommit: (placements: ChartGridPlacement[]) => void;
    renderCard: (placement: ChartGridPlacement) => React.ReactNode;
  }) => {
    gridPlacements.push(...placements);
    latestPlacements.length = 0;
    latestPlacements.push(...placements);
    return (
      <>
        {/* The real grid commits once, on drop or resize-end, with the whole
            grid's new layout. This is that call and nothing else: dragging
            itself is a pointer gesture jsdom has no width to lay out. It sits
            OUTSIDE the grid element, whose children are counted as cards. */}
        <button
          type="button"
          data-testid="finish-a-drag"
          onClick={() =>
            onPlacementsCommit(
              placements.map((placement, index) =>
                index === 0
                  ? { ...placement, gridRow: placement.gridRow + 4 }
                  : placement,
              ),
            )
          }
        >
          finish a drag
        </button>
        <div data-testid="chart-grid">
          {placements.map((placement) => (
            <div key={placement.graphId}>{renderCard(placement)}</div>
          ))}
        </div>
      </>
    );
  },
}));

import { writeSampleChoice } from "~/components/governance/sample/sampleMode";
import DashboardsPage from "../dashboards";

/** The four widgets, by the name a reader sees on the card. */
const WIDGET_NAMES = [
  "Spend over time by provider",
  "Cost by department",
  "Cost by person",
  "Cost by model and agent",
];

/**
 * The four queries the widgets name. Nothing answers these from a database
 * yet — the cost rollup is not in the query catalog — so sample mode is the
 * only state in which a chart is drawn at all.
 */
const QUERY_NAMES = ["provider_day", "department", "person", "model_agent"];

/** Controls that would imply the page is a workspace rather than a picture. */
const WRITE_AFFORDANCE = /rename|edit|delete|duplicate|add widget|save|share/i;

const APP_ROOT = process.cwd();
const PAGE_FILE = "src/pages/governance/dashboards.tsx";
const COMPONENTS_DIR = "src/components/governance/dashboards";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <DashboardsPage />
    </ChakraProvider>,
  );
}

const recordedFrames = () => frameProps as RecordedFrame[];

const writeControls = (role: "button" | "menuitem") =>
  screen
    .queryAllByRole(role)
    .filter((control) => WRITE_AFFORDANCE.test(control.textContent ?? ""));

beforeEach(() => {
  harness.permissions = getOrganizationRolePermissions("ADMIN");
  harness.flagEnabled = true;
  harness.colorMode = "light";
  frameProps.length = 0;
  gridPlacements.length = 0;
  latestPlacements.length = 0;
  // The choice is section-wide and lives in session storage, which the lane
  // shares between files; clear both halves so each test states its own.
  writeSampleChoice(null);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // `restoreAllMocks` puts spies back but leaves stubbed globals in place, and
  // the run test stubs two of them.
  vi.unstubAllGlobals();
});

describe("given the billed-cost flag is off for a permitted viewer", () => {
  /** @scenario "The page stays behind the billed-cost release flag" */
  it("shows the not-found scene in place of the page", () => {
    // The actor HOLDS the permission, so the permission guard cannot be what
    // hides the page — which is what makes this about the FLAG.
    expect(
      hasPermissionWithHierarchy(harness.permissions, "governanceCost:view"),
    ).toBe(true);

    harness.flagEnabled = false;
    renderPage();

    expect(screen.getByText("this page does not exist")).toBeInTheDocument();
    for (const name of WIDGET_NAMES) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }

    // …and the identical setup with the flag ON renders the page.
    cleanup();
    harness.flagEnabled = true;
    renderPage();
    expect(
      screen.getByRole("heading", { name: WIDGET_NAMES[0] }),
    ).toBeInTheDocument();
  });
});

describe("given a viewer without the governance cost permission", () => {
  /** @scenario "The page stays behind the billed-cost release flag" */
  it("shows the access-restricted notice instead of the widgets", () => {
    harness.permissions = [];
    harness.flagEnabled = true;
    renderPage();

    // The guard's own fallback, not the not-found scene: a member who is
    // simply not entitled is told so, rather than told the page is imaginary.
    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(
      screen.getByText(/Required permission: governanceCost:view/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("this page does not exist"),
    ).not.toBeInTheDocument();
    for (const name of WIDGET_NAMES) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });
});

describe("given the page is open with sample data off", () => {
  beforeEach(() => {
    writeSampleChoice(false);
  });

  /** @scenario "Four cost widgets are laid out on the grid" */
  it("lays exactly four named widgets on the grid", () => {
    renderPage();

    for (const name of WIDGET_NAMES) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(gridPlacements).toHaveLength(4);
  });

  /** @scenario "Four cost widgets are laid out on the grid" */
  it("spans the provider and model charts full width, the other two side by side between them", () => {
    renderPage();

    const placements = gridPlacements as ChartGridPlacement[];
    const byRow = [...placements].sort(
      (a, b) => a.gridRow - b.gridRow || a.gridColumn - b.gridColumn,
    );
    const [provider, department, person, model] = byRow;

    expect(provider?.colSpan).toBe(CHART_GRID_COLUMNS);
    expect(model?.colSpan).toBe(CHART_GRID_COLUMNS);
    // Side by side: one row, two halves, no overlap.
    expect(department?.gridRow).toBe(person?.gridRow);
    expect(department?.colSpan).toBe(CHART_GRID_COLUMNS / 2);
    expect(person?.colSpan).toBe(CHART_GRID_COLUMNS / 2);
    expect(department?.gridColumn).toBe(0);
    expect(person?.gridColumn).toBe(CHART_GRID_COLUMNS / 2);
    // Between them: under the provider chart, above the model one.
    expect(provider!.gridRow).toBeLessThan(department!.gridRow);
    expect(model!.gridRow).toBeGreaterThan(person!.gridRow);
  });

  /** @scenario "A card stays where the reader drags it" */
  it("keeps a moved card where it was dropped, and through a later render", () => {
    renderPage();

    const authored = [...(latestPlacements as ChartGridPlacement[])];
    const moved = authored[0]!;

    fireEvent.click(screen.getByTestId("finish-a-drag"));

    // The grid is draggable by construction, so a card the reader drags must
    // not spring back to where it was authored the moment React renders again.
    const afterDrag = latestPlacements as ChartGridPlacement[];
    expect(afterDrag).toHaveLength(4);
    expect(
      afterDrag.find((placement) => placement.graphId === moved.graphId)
        ?.gridRow,
    ).toBe(moved.gridRow + 4);

    // …and it survives a render the reader causes for another reason.
    fireEvent.click(screen.getByRole("button", { name: /time frame/i }));
    const afterRerender = latestPlacements as ChartGridPlacement[];
    expect(
      afterRerender.find((placement) => placement.graphId === moved.graphId)
        ?.gridRow,
    ).toBe(moved.gridRow + 4);

    // …and no further than that. There is no row behind this page to save a
    // layout to, so the next visit opens on the authored arrangement — which
    // is the half of the promise the source scan cannot see.
    cleanup();
    renderPage();
    expect(
      (latestPlacements as ChartGridPlacement[]).find(
        (placement) => placement.graphId === moved.graphId,
      )?.gridRow,
    ).toBe(moved.gridRow);
  });

  /** @scenario "Sample off shows an empty widget that says what would fill it" */
  it("draws no chart, says what would fill each widget, and claims nothing failed", () => {
    renderPage();

    expect(screen.queryAllByTestId("chart-frame")).toHaveLength(0);

    // Each card names the way to fill it. Nothing failed, so nothing on the
    // page may announce a failure — a red card here sends a cost owner
    // looking for a broken read that does not exist.
    const cards = screen
      .getAllByTestId("chart-grid")
      .flatMap((grid) => Array.from(grid.children));
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(
        within(card as HTMLElement).getByText(/nothing measured yet/i),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * The switch is section-wide and there is one of it, so it is offered in
   * one place. Four empty cards each carrying their own copy read as four
   * separate decisions over a single choice.
   *
   * @scenario "Sample off shows an empty widget that says what would fill it"
   */
  it("offers the sample choice once, in the header, and not on any card", () => {
    renderPage();

    const cards = screen
      .getAllByTestId("chart-grid")
      .flatMap((grid) => Array.from(grid.children));
    for (const card of cards) {
      expect(
        within(card as HTMLElement).queryByRole("button", {
          name: /sample data/i,
        }),
      ).not.toBeInTheDocument();
    }

    expect(
      screen.getAllByRole("button", { name: /sample data/i }),
    ).toHaveLength(1);
  });

  /** @scenario "Nothing on the page itself can save a widget or a dashboard" */
  it("offers no control that would add, edit or save anything", () => {
    renderPage();

    expect(writeControls("button")).toHaveLength(0);
    expect(writeControls("menuitem")).toHaveLength(0);
  });
});

describe("given the page is open with sample data on", () => {
  beforeEach(() => {
    writeSampleChoice(true);
  });

  /** @scenario "Sample on fills every widget from invented figures" */
  it("draws every widget under a banner that says nothing on the page is real", () => {
    renderPage();

    expect(screen.getAllByTestId("chart-frame")).toHaveLength(4);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/nothing[\s\S]*real/i);
  });

  /** @scenario "Sample on fills every widget from invented figures" */
  it("hands each chart a context carrying no project to read against", () => {
    renderPage();

    const frames = recordedFrames();
    expect(frames).toHaveLength(4);
    for (const frame of frames) {
      // Not merely undefined: absent. A context with no project in it is what
      // makes an accidental real read impossible rather than unlikely.
      expect(Object.keys(frame.dashboardContext)).not.toContain("projectId");
      expect(frame.code.length).toBeGreaterThan(0);
    }
  });

  /** @scenario "Sample on fills every widget from invented figures" */
  it("answers all four queries from invented figures with no request leaving the browser", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderPage();

    const frames = recordedFrames();
    expect(frames).toHaveLength(4);

    const answered = new Set<string>();
    for (const frame of frames) {
      const answeredHere: string[] = [];
      for (const queryName of QUERY_NAMES) {
        const result = await frame
          .executeQuery({
            queryName,
            params: {},
            signal: new AbortController().signal,
          })
          .catch(() => null);
        if (result && result.columns.length > 0) {
          answeredHere.push(queryName);
          answered.add(queryName);
        }
      }
      // A frame whose executor answers nothing is a card that draws blank.
      expect(answeredHere.length).toBeGreaterThan(0);
    }
    expect([...answered].sort()).toEqual([...QUERY_NAMES].sort());

    // The whole point of inventing the figures: nothing was asked of anyone.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /** @scenario "Nothing on the page itself can save a widget or a dashboard" */
  it("offers no control that would add, edit or save anything", () => {
    renderPage();

    expect(writeControls("button")).toHaveLength(0);
    expect(writeControls("menuitem")).toHaveLength(0);
  });
});

describe("given a reader who has chosen a colour mode", () => {
  beforeEach(() => {
    writeSampleChoice(true);
  });

  /** @scenario "Every widget is drawn in the colour mode the reader is in" */
  it("tells every chart the mode the reader is actually in", () => {
    harness.colorMode = "dark";
    renderPage();

    // A chart fixed to light paints white panels down a dark page, and the
    // author code inside the frame has no other way to know.
    expect(recordedFrames()).toHaveLength(4);
    for (const frame of recordedFrames()) {
      expect(frame.dashboardContext.theme).toBe("dark");
    }

    cleanup();
    frameProps.length = 0;
    harness.colorMode = "light";
    renderPage();

    expect(recordedFrames()).toHaveLength(4);
    for (const frame of recordedFrames()) {
      expect(frame.dashboardContext.theme).toBe("light");
    }
  });
});

describe("given a member who wants to see what one chart asks", () => {
  beforeEach(() => {
    writeSampleChoice(true);
  });

  const cardTitled = (name: string) =>
    screen
      .getAllByTestId("governance-widget-card")
      .find((card) => within(card).queryByText(name) !== null)!;

  /**
   * The drawer mounts through a portal, so nothing inside it is in the
   * document on the tick the click returns. Resolves on the statement itself,
   * which is the first thing inside the drawer this page is answerable for.
   */
  const openQueryDrawer = async (widgetName: string) => {
    fireEvent.click(
      within(cardTitled(widgetName)).getByRole("button", { name: /query/i }),
    );
    return (await screen.findByTestId(
      "widget-editor-sql",
    )) as HTMLTextAreaElement;
  };

  /** @scenario "The member can open the query behind one widget from its own card" */
  it("offers the query behind each widget on that widget's own card", () => {
    renderPage();

    const cards = screen.getAllByTestId("governance-widget-card");
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(
        within(card).getByRole("button", { name: /query/i }),
      ).toBeInTheDocument();
    }
  });

  /** @scenario "The member can open the query behind one widget from its own card" */
  it("opens the product's own editor on that widget, statement and all", async () => {
    renderPage();
    const editor = await openQueryDrawer("Cost by department");

    // That widget's own statement, not a placeholder and not a sibling's: the
    // rollup table names the page, the grouping names the widget.
    expect(editor.value).toContain("governance_cost_rollup_1d");
    expect(editor.value).toContain("AS department");

    // The editor is the product's own, whole: it carries the widget's name,
    // the tab switcher, and a Save.
    expect(screen.getAllByText("Cost by department").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /code/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  /** @scenario "Running a statement in the editor answers from the invented figures" */
  it("runs the statement against the invented figures and asks nobody", async () => {
    // Every way out of the page jsdom gives it, not just `fetch`: the scenario
    // says no request leaves the browser, and a watch on one door only proves
    // that one door stayed shut.
    const doors = {
      fetch: vi.spyOn(globalThis, "fetch"),
      xhr: vi.spyOn(XMLHttpRequest.prototype, "open"),
      beacon: vi.fn(),
      socket: vi.fn(),
    };
    vi.stubGlobal("navigator", {
      ...navigator,
      sendBeacon: doors.beacon,
    });
    vi.stubGlobal(
      "WebSocket",
      class {
        constructor(...args: unknown[]) {
          doors.socket(...args);
        }
      },
    );

    renderPage();
    await openQueryDrawer("Cost by department");

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));

    // The invented department answer is a handful of rows; the point is that
    // the Run is honoured at all, by the only figures this page has.
    await waitFor(() =>
      expect(screen.getAllByText(/\d+ rows?/).length).toBeGreaterThan(0),
    );
    for (const [name, door] of Object.entries(doors)) {
      expect(door, `${name} was used`).not.toHaveBeenCalled();
    }
  });

  /**
   * A row count describes the statement it was read from. Once that statement
   * has been edited the count describes nothing on screen, so leaving it beside
   * the new one reports an answer nobody asked for — and reports it as if the
   * edit had already been run.
   *
   * @scenario "Running a statement in the editor answers from the invented figures"
   */
  it("drops what a run reported once the statement it read is edited away", async () => {
    renderPage();
    const editor = await openQueryDrawer("Cost by department");

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/\d+ rows?/).length).toBeGreaterThan(0),
    );

    // Saved, so the statement on screen is no longer the one that was run.
    fireEvent.change(editor, { target: { value: "SELECT 7" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("widget-editor-sql")).not.toBeInTheDocument(),
    );

    await openQueryDrawer("Cost by department");
    expect(screen.queryAllByText(/\d+ rows?/)).toHaveLength(0);
  });

  /** @scenario "The editor draws no invented figures the reader has turned off" */
  it("draws no chart and answers no run while the sample choice is off", async () => {
    // The state the page OPENS in, and the state in which the banner that says
    // the figures are invented is not on screen at all.
    writeSampleChoice(false);
    renderPage();
    expect(screen.queryByText(/nothing here is real/i)).not.toBeInTheDocument();

    const editor = await openQueryDrawer("Cost by department");

    // The statement is the question, not a figure, so it stays readable.
    expect(editor.value).toContain("governance_cost_rollup_1d");

    // No chart anywhere — not on the card, and not in the editor either.
    expect(recordedFrames()).toHaveLength(0);

    // And a Run says which switch is off rather than handing over invented
    // money the reader has just asked not to see.
    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    // The refusal's OWN words, not merely that something refused: a generic
    // "something went wrong" here would read as a broken page rather than as
    // a switch the reader has not turned on, and only the words tell them
    // apart.
    await waitFor(() =>
      expect(
        screen.getByText(/nothing is drawn until you ask to see sample data/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryAllByText(/\d+ rows?/)).toHaveLength(0);

    // And it must not claim anything FAILED. Nothing did: the reader has a
    // switch turned off. The card already refuses to draw a red panel in this
    // state for the same reason — a failure here sends a cost owner hunting
    // for a broken read that does not exist.
    expect(screen.queryByText(/query failed/i)).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/sample data is off/i).length,
    ).toBeGreaterThanOrEqual(1);
  });

  /** @scenario "An edit made in the editor lasts the visit and no longer" */
  it("keeps a saved change for the visit and loses it on the next one", async () => {
    renderPage();
    const editor = await openQueryDrawer("Cost by department");

    fireEvent.change(editor, {
      target: { value: "SELECT 1 FROM governance_cost_rollup_1d" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.queryByTestId("widget-editor-sql")).not.toBeInTheDocument(),
    );

    const reopened = await openQueryDrawer("Cost by department");
    expect(reopened.value).toBe("SELECT 1 FROM governance_cost_rollup_1d");

    // Nothing was written, so the next visit opens on what the repository
    // authored — which is the whole of what Save means on this page.
    cleanup();
    frameProps.length = 0;
    renderPage();
    const fresh = await openQueryDrawer("Cost by department");
    expect(fresh.value).not.toBe("SELECT 1 FROM governance_cost_rollup_1d");
    expect(fresh.value).toContain("governance_cost_rollup_1d");
  });
});

describe("given the page's own source", () => {
  const sourceFiles = () => {
    const files = [PAGE_FILE];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(APP_ROOT, dir), {
        withFileTypes: true,
      })) {
        if (entry.name === "__tests__") continue;
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk(COMPONENTS_DIR);
    return files.map((file) => ({
      file,
      source: readFileSync(join(APP_ROOT, file), "utf-8"),
    }));
  };

  /**
   * The render-side tests above can only prove that the controls a test
   * happened to name are absent. This reads the SOURCE, where a write is
   * visible whether or not anything renders it: a mutation hook, the tRPC
   * client, or any of the widget-authoring pieces whose whole purpose is to
   * persist a dashboard.
   *
   * @scenario "Nothing on the page itself can save a widget or a dashboard"
   */
  it("imports nothing that could write a row", () => {
    const files = sourceFiles();
    // The guard against a vacuous pass: a walk that found nothing would
    // otherwise report a page full of mutations clean.
    expect(files.length).toBeGreaterThan(1);

    const forbidden = [
      "useMutation",
      'from "~/utils/api"',
      "DashboardWidgetGrid",
      "DashboardWidgetCard",
      "GraphCardMenu",
      "useDashboardWidgetExecutor",
      "getOrCreateFirst",
    ];
    for (const { file, source } of files) {
      expect(source.length).toBeGreaterThan(0);
      for (const needle of forbidden) {
        expect(`${file}: ${source}`).not.toContain(needle);
      }
    }
  });

  /** @scenario "The page stays behind the billed-cost release flag" */
  it("composes the same three guards Costs is behind", () => {
    const source = readFileSync(join(APP_ROOT, PAGE_FILE), "utf-8");

    expect(source).toContain(
      'withFeatureFlagGuard("release_ui_ai_governance_enabled"',
    );
    expect(source).toContain(
      'withFeatureFlagGuard("release_ui_governance_billed_cost_enabled"',
    );
    expect(source).toContain('withPermissionGuard("governanceCost:view"');
  });
});
