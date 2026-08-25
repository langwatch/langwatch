/**
 * @vitest-environment jsdom
 *
 * The rail of the Test cases tab: All test cases, the test suites, the sets
 * that run from code, and the period picker at its foot.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/suites/suite-folders.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeRelativeWindow } from "~/components/PeriodSelector";
import { CasesPanel } from "../cases/CasesPanel";
import { SuiteRail } from "../cases/SuiteRail";
import {
  groupCasesByFolder,
  type TestCase,
  type TestSuiteEntry,
} from "../cases/test-cases";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), isReady: true }),
}));

// The real picker renders; this only records how the rail asked for it, which
// is what decides the direction it opens in. jsdom has no layout, so the
// placement never reaches the DOM.
const periodSelectorProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("~/components/PeriodSelector", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/components/PeriodSelector")>();
  return {
    ...actual,
    PeriodSelector: (
      props: React.ComponentProps<typeof actual.PeriodSelector>,
    ) => {
      periodSelectorProps.current = props as unknown as Record<string, unknown>;
      return <actual.PeriodSelector {...props} />;
    },
  };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({
  formatTimeAgoCompact: () => "2h ago",
  formatTimeAgo: () => "2 hours ago",
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const THIRTY_DAYS = computeRelativeWindow("30d", new Date());

function makeSuite(overrides: Partial<TestSuiteEntry> = {}): TestSuiteEntry {
  return {
    id: "suite_1",
    name: "Refunds",
    slug: "refunds",
    caseCount: 3,
    ...overrides,
  };
}

function renderRail(
  overrides: Partial<React.ComponentProps<typeof SuiteRail>> = {},
) {
  const props: React.ComponentProps<typeof SuiteRail> = {
    selection: { kind: "all" },
    suites: [makeSuite()],
    externalSets: [],
    canManage: true,
    suiteIdsWithRuns: new Set<string>(["suite_1"]),
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onSelect: vi.fn(),
    onCreateSuite: vi.fn(),
    onNewTestCase: vi.fn(),
    onRunSuite: vi.fn(),
    onEditSuite: vi.fn(),
    onOpenLastRun: vi.fn(),
    onArchiveSuite: vi.fn(),
    period: THIRTY_DAYS,
    periodMode: "relative",
    setPeriod: vi.fn(),
    setRelativePeriod: vi.fn(),
    ...overrides,
  };
  const view = render(<SuiteRail {...props} />, { wrapper: Wrapper });
  return { props, view };
}

async function openSuiteMenu(suiteName: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `Actions for ${suiteName}` }),
  );
  return user;
}

describe("the test suites rail", () => {
  afterEach(cleanup);

  /** @scenario "The rail lists All test cases, then the test suites, then the external sets" */
  it("lists All test cases, then the test suites, then the external sets", () => {
    renderRail({
      suites: [
        makeSuite(),
        makeSuite({ id: "suite_2", name: "Checkout", slug: "checkout" }),
      ],
      externalSets: [{ setId: "nightly-ci", lastRunTimestamp: 1 }],
    });

    expect(screen.getByText("Test Suites")).toBeInTheDocument();
    expect(screen.getByText("External Sets")).toBeInTheDocument();

    const rail = screen.getByTestId("agent-testing-suite-rail");
    const entries = within(rail)
      .getAllByRole("button")
      .map((element) => element.getAttribute("data-testid"))
      .filter((id): id is string => !!id?.startsWith("suite-rail-item-"));

    expect(entries).toEqual([
      "suite-rail-item-All test cases",
      "suite-rail-item-Refunds",
      "suite-rail-item-Checkout",
      "suite-rail-item-nightly-ci",
    ]);

    // No row carries a count: the case count reads beside the panel title.
    // The external row is the one that carries a number, its last run time.
    for (const entry of entries.slice(0, 3)) {
      expect(screen.getByTestId(entry).textContent).not.toMatch(/\d/);
    }
  });

  /** @scenario "The rail lists All test cases, then the test suites, then the external sets" */
  it("nests no button inside a rail row", () => {
    renderRail({
      suites: [makeSuite({ id: "suite_1", name: "Refunds", slug: "refunds" })],
      externalSets: [],
    });

    const row = screen.getByTestId("suite-rail-item-Refunds");
    expect(row.tagName).not.toBe("BUTTON");
    expect(row).toHaveAttribute("role", "button");
    // The row menu lives inside the row, so the row itself must not be one.
    expect(within(row).getByLabelText("Actions for Refunds").tagName).toBe(
      "BUTTON",
    );
  });

  /** @scenario "An external set carries the code icon and no counts" */
  it("carries the code icon and the last run time on an external set, and no Run", () => {
    renderRail({
      suites: [],
      externalSets: [{ setId: "nightly-ci", lastRunTimestamp: 1 }],
    });

    const row = screen.getByTestId("suite-rail-item-nightly-ci");
    expect(within(row).getByLabelText("Runs from code")).toBeInTheDocument();
    expect(within(row).getByText("2h ago")).toBeInTheDocument();
    expect(
      within(row).queryByRole("button", { name: /Actions for/ }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "A project with no external sets hides the External Sets heading" */
  it("hides the External Sets heading when the project has none", () => {
    renderRail({ externalSets: [] });

    expect(screen.queryByText("External Sets")).not.toBeInTheDocument();
  });

  /** @scenario "The rail offers to create a test suite" */
  it("offers to create a test suite and lists the new one", async () => {
    const user = userEvent.setup();
    const { props, view } = renderRail({ suites: [] });

    await user.click(screen.getByRole("button", { name: "New test suite" }));
    await user.type(await screen.findByLabelText("Test suite name"), "Refunds");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(props.onCreateSuite).toHaveBeenCalledWith("Refunds");

    view.rerender(<SuiteRail {...props} suites={[makeSuite()]} />);
    expect(screen.getByTestId("suite-rail-item-Refunds")).toBeInTheDocument();
  });

  /** @scenario "The row menu of a test suite offers its five actions in order" */
  it("offers its five actions in order", async () => {
    renderRail();
    await openSuiteMenu("Refunds");

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual([
      "New test case",
      "Run suite",
      "Edit suite",
      "Open last run",
      "Archive suite",
    ]);
  });

  /** @scenario "Open last run goes straight to the last run of that suite" */
  it("opens the last run of that suite", async () => {
    const { props } = renderRail();
    const user = await openSuiteMenu("Refunds");

    await user.click(
      await screen.findByRole("menuitem", { name: "Open last run" }),
    );

    // The tab answers this by opening the Results tab on that suite, where the
    // newest run of the plan is the one selected.
    expect(props.onOpenLastRun).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "refunds" }),
    );
  });

  /** @scenario "Open last run is not offered for a suite that never ran" */
  it("does not offer Open last run for a suite that never ran", async () => {
    renderRail({ suiteIdsWithRuns: new Set<string>() });
    await openSuiteMenu("Refunds");

    expect(
      await screen.findByRole("menuitem", { name: "Run suite" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Open last run" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Archive suite opens the confirmation dialog" */
  /** @scenario "The archive dialog names the folder and says what happens to its cases" */
  it("names the suite in the archive dialog and says its cases go with it", async () => {
    const { props, view } = renderRail();
    const user = await openSuiteMenu("Refunds");

    await user.click(
      await screen.findByRole("menuitem", { name: "Archive suite" }),
    );

    expect(await screen.findByText("Archive test suite?")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Refunds")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "The test cases in it are archived as well. Test runs are preserved.",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(props.onArchiveSuite).toHaveBeenCalledWith("suite_1");

    view.rerender(<SuiteRail {...props} suites={[]} />);
    expect(
      screen.queryByTestId("suite-rail-item-Refunds"),
    ).not.toBeInTheDocument();
  });

  it("archives nothing when the archive dialog is left without confirming", async () => {
    const { props } = renderRail();
    const user = await openSuiteMenu("Refunds");

    await user.click(
      await screen.findByRole("menuitem", { name: "Archive suite" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(props.onArchiveSuite).not.toHaveBeenCalled();
  });

  /** @scenario "A person with read-only access sees no changing actions in the row menu" */
  it("offers only Open last run to a person with read-only access", async () => {
    renderRail({ canManage: false });
    await openSuiteMenu("Refunds");

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );
    expect(items).toEqual(["Open last run"]);
    expect(
      screen.queryByRole("button", { name: "New test suite" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "Choosing a suite filters the case table to that suite" */
  it("filters the case table to the chosen suite and marks it as selected", async () => {
    const user = userEvent.setup();
    const { props, view } = renderRail({
      suites: [
        makeSuite(),
        makeSuite({ id: "suite_2", name: "Checkout", slug: "checkout" }),
      ],
    });

    await user.click(screen.getByTestId("suite-rail-item-Refunds"));
    expect(props.onSelect).toHaveBeenCalledWith({
      kind: "suite",
      slug: "refunds",
    });

    view.rerender(
      <SuiteRail
        {...props}
        suites={[
          makeSuite(),
          makeSuite({ id: "suite_2", name: "Checkout", slug: "checkout" }),
        ]}
        selection={{ kind: "suite", slug: "refunds" }}
      />,
    );
    expect(screen.getByTestId("suite-rail-item-Refunds")).toHaveAttribute(
      "aria-current",
      "true",
    );

    const refundsCase = makeCase({ id: "case_1", name: "Double charge" });
    const checkoutCase = makeCase({
      id: "case_2",
      name: "Card declined",
      folderId: "suite_2",
    });
    render(
      <CasesPanel
        {...casesPanelProps({
          selection: { kind: "suite", slug: "refunds" },
          title: "Refunds",
          groups: [{ id: "suite_1", name: "Refunds", cases: [refundsCase] }],
        })}
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText("Double charge")).toBeInTheDocument();
    expect(screen.queryByText(checkoutCase.name)).not.toBeInTheDocument();
  });

  /** @scenario "Choosing an external set opens its results" */
  it("opens the results of an external set and offers no Edit for it", async () => {
    const user = userEvent.setup();
    const { props } = renderRail({
      externalSets: [{ setId: "nightly-ci", lastRunTimestamp: 1 }],
    });

    await user.click(screen.getByTestId("suite-rail-item-nightly-ci"));

    expect(props.onSelect).toHaveBeenCalledWith({
      kind: "external",
      setId: "nightly-ci",
    });
    expect(
      screen.queryByRole("menuitem", { name: "Edit suite" }),
    ).not.toBeInTheDocument();
  });

  /** @scenario "The period picker sits at the foot of the rail and starts at thirty days" */
  it("puts a compact thirty day period picker at the foot of the rail", () => {
    renderRail();

    const rail = screen.getByTestId("agent-testing-suite-rail");
    expect(
      within(rail).getByRole("button", { name: "Last 30 days" }),
    ).toBeInTheDocument();
    expect(periodSelectorProps.current?.size).toBe("xs");
  });

  /** @scenario "The period picker opens upward at the foot of the rail" */
  it("opens the period list above the control", async () => {
    const user = userEvent.setup();
    renderRail();

    await user.click(screen.getByRole("button", { name: "Last 30 days" }));

    expect(await screen.findByText("Select Date Range")).toBeInTheDocument();
    expect(periodSelectorProps.current?.placement).toBe("top-start");
  });

  /** @scenario "Changing the period reloads the last results and the runs" */
  it("reloads on a shorter period", async () => {
    const user = userEvent.setup();
    const { props } = renderRail();

    await user.click(screen.getByRole("button", { name: "Last 30 days" }));
    await user.click(await screen.findByText("Last 7 days"));

    // usePeriodSelector writes the window into the address, and every read of
    // the tab is keyed by that window, so the cells and the runs come back for
    // the shorter period.
    expect(props.setRelativePeriod).toHaveBeenCalledWith("7d");
  });

  /** @scenario "The rail keeps the voice agents note" */
  it("keeps the voice agents note", () => {
    renderRail();

    expect(screen.getByText("Try voice agent simulations")).toBeInTheDocument();
  });
});

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: "case_1",
    name: "Double charge",
    labels: [],
    folderId: "suite_1",
    createdAt: new Date("2026-02-06T10:00:00.000Z"),
    lastUpdatedById: null,
    ...overrides,
  };
}

function casesPanelProps(
  overrides: Partial<React.ComponentProps<typeof CasesPanel>> = {},
): React.ComponentProps<typeof CasesPanel> {
  return {
    selection: { kind: "all" },
    title: "All test cases",
    groups: groupCasesByFolder({ cases: [], suites: [] }),
    externalCases: [],
    isLoading: false,
    lastResults: new Map(),
    isLastResultsLoading: false,
    authorNameById: {},
    suites: [],
    canManage: true,
    projectHasNoCases: false,
    allLabels: [],
    activeLabels: [],
    onToggleLabel: vi.fn(),
    onRunSet: vi.fn(),
    onNewTestCase: vi.fn(),
    onSelectSuite: vi.fn(),
    onRowClick: vi.fn(),
    onRunCase: vi.fn(),
    onEdit: vi.fn(),
    onHistory: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveToSuite: vi.fn(),
    onOpenLastRun: vi.fn(),
    onArchive: vi.fn(),
    onOpenExternalCase: vi.fn(),
    ...overrides,
  };
}
