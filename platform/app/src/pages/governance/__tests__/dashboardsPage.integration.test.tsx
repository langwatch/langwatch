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
 * The real grid measures its container through a `ResizeObserver` and renders
 * nothing until it has a width, neither of which jsdom provides — so a page
 * rendered against the real one would show no cards at all and every absence
 * below would pass for the wrong reason. The stub renders each card and keeps
 * the placements, which is also what makes the layout assertion possible.
 */
const gridPlacements = vi.hoisted(() => [] as unknown[]);
vi.mock("~/components/analytics/reports/ChartGrid", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/components/analytics/reports/ChartGrid")
  >()),
  ChartGrid: ({
    placements,
    renderCard,
  }: {
    placements: ChartGridPlacement[];
    renderCard: (placement: ChartGridPlacement) => React.ReactNode;
  }) => {
    gridPlacements.push(...placements);
    return (
      <div data-testid="chart-grid">
        {placements.map((placement) => (
          <div key={placement.graphId}>{renderCard(placement)}</div>
        ))}
      </div>
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
  frameProps.length = 0;
  gridPlacements.length = 0;
  // The choice is section-wide and lives in session storage, which the lane
  // shares between files; clear both halves so each test states its own.
  writeSampleChoice(null);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
        within(card as HTMLElement).getByText(/turn on sample data/i),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /** @scenario "Sample off shows an empty widget that says what would fill it" */
  it("fills every widget when the sample choice is taken from a card", async () => {
    renderPage();

    fireEvent.click(
      screen.getAllByRole("button", { name: /turn on sample data/i })[0]!,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("chart-frame")).toHaveLength(4),
    );
  });

  /** @scenario "Nothing on the page can save a widget or a dashboard" */
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

  /** @scenario "Nothing on the page can save a widget or a dashboard" */
  it("offers no control that would add, edit or save anything", () => {
    renderPage();

    expect(writeControls("button")).toHaveLength(0);
    expect(writeControls("menuitem")).toHaveLength(0);
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
   * @scenario "Nothing on the page can save a widget or a dashboard"
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
