/**
 * @vitest-environment jsdom
 * The widget editor drawer on the design-system Drawer and ContentTabs: its tab keys, the
 * Add query action beside (not inside) the tablist, and the Save and Cancel footer.
 * The two editor panels are light stand-ins that count their mounts; no Monaco runs here.
 */

import type { DashboardWidgetQuery } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type * as QueriesPanelModule from "../features/dashboard-widget/ui/sections/dashboard-widget-queries-panel.tsx";
import { renderWithAnalyticsHost } from "../testing.tsx";
import { SummaryMetric } from "../ui/elements/summary-metric.tsx";
import type { CustomGraphInput } from "../ui/sections/custom-graph.tsx";

const mounts = vi.hoisted(() => ({ code: 0, queries: 0 }));
const dashboardRows = vi.hoisted(() => [{ id: "dash-1", name: "Latency" }]);

vi.mock("../behavior/use-dashboards.ts", () => ({
  useDashboards: () => ({ data: dashboardRows, isLoading: false }),
}));

function MockCustomGraph({ input }: { input: CustomGraphInput }) {
  const series = input.series[0];
  if (input.graphType === "summary") {
    return (
      <SummaryMetric
        label={series?.name ?? input.graphId}
        current={0}
        previous={0}
        tooltip={`About ${series?.name ?? input.graphId}`}
        noDataUrl={series?.noDataUrl}
      />
    );
  }
  return <div data-testid={`graph-${input.graphId}`} />;
}

function MockCodeEditor() {
  const [mount] = useState(() => ++mounts.code);
  return <div data-testid="code-editor" data-mount={mount} />;
}

function MockQueriesPanel() {
  const [mount] = useState(() => ++mounts.queries);
  return <div data-testid="queries-panel" data-mount={mount} />;
}

vi.mock("../ui/sections/custom-graph.tsx", () => ({ CustomGraph: MockCustomGraph }));
vi.mock("../ui/sections/llm-summary.tsx", () => ({ LLMSummary: () => null }));
vi.mock("../ui/sections/topics-selector.tsx", () => ({ TopicsSelector: () => null }));
vi.mock("../features/dashboard-widget/ui/sections/dashboard-widget-code-editor.tsx", () => ({
  DashboardWidgetCodeEditor: MockCodeEditor,
}));
vi.mock(
  "../features/dashboard-widget/ui/sections/dashboard-widget-queries-panel.tsx",
  async (importOriginal) => ({
    ...(await importOriginal<typeof QueriesPanelModule>()),
    DashboardWidgetQueriesPanel: MockQueriesPanel,
  }),
);

import { DashboardWidgetEditDrawer } from "../features/dashboard-widget/ui/sections/dashboard-widget-edit-drawer.tsx";
import { CustomReportsSection } from "../ui/sections/analytics/analytics-overview.screen.tsx";
import { LLMMetrics } from "../ui/sections/llm-metrics.tsx";
import { UserMetrics } from "../ui/sections/user-metrics.tsx";

// No added tabs: Code and Queries only.
type DrawerProps = ComponentProps<typeof DashboardWidgetEditDrawer<never>>;

const validQueries: DashboardWidgetQuery[] = [{ name: "query1", sql: "select 1" }];

function baseProps(overrides: Partial<DrawerProps> = {}): DrawerProps {
  return {
    open: true,
    projectId: "proj-1",
    chart: <div>preview</div>,
    id: "widget-1",
    name: "Latency",
    onNameChange: vi.fn(),
    code: "",
    queries: validQueries,
    onCodeChange: vi.fn(),
    onQueriesChange: vi.fn(),
    lastRuns: {},
    onRun: vi.fn(async () => {}),
    isDirty: true,
    isSaving: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
    activeTab: "code",
    onTabChange: vi.fn(),
    ...overrides,
  };
}

function renderDrawer(overrides: Partial<DrawerProps> = {}) {
  const props = baseProps(overrides);
  renderWithAnalyticsHost(<DashboardWidgetEditDrawer {...props} />);
  return props;
}

function ControlledDrawer({ onTabChange }: { onTabChange: (tab: "code" | "queries") => void }) {
  const [activeTab, setActiveTab] = useState<"code" | "queries">("code");
  return (
    <DashboardWidgetEditDrawer
      {...baseProps({
        activeTab,
        onTabChange: (tab) => {
          onTabChange(tab);
          setActiveTab(tab);
        },
      })}
    />
  );
}

const blockedSaves: { case: string; overrides: Partial<DrawerProps>; reason: string }[] = [
  {
    case: "the draft is unchanged",
    overrides: { isDirty: false },
    reason: "No changes to save",
  },
  {
    case: "a query name is blank",
    overrides: { queries: [{ name: "  ", sql: "select 1" }] },
    reason: "Give every query a non-empty, unique name",
  },
  {
    case: "two queries share a name",
    overrides: {
      queries: [
        { name: "query1", sql: "select 1" },
        { name: "query1", sql: "select 2" },
      ],
    },
    reason: "Give every query a non-empty, unique name",
  },
  {
    case: "a declared parameter has a reserved name",
    overrides: {
      queries: [
        {
          name: "query1",
          sql: "select 1",
          parameters: [{ name: "dashboard_context_period_start", type: "string" }],
        },
      ],
    },
    reason: "A declared parameter has an invalid name",
  },
];

describe("the widget editor drawer", () => {
  it("is named after the widget while the name stays editable", () => {
    renderDrawer();

    expect(screen.getByRole("dialog", { name: "Latency" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Latency" })).toBeInTheDocument();
  });

  describe("when switching tabs", () => {
    it("moves between Code and Queries with the arrow, Home and End keys", async () => {
      const onTabChange = vi.fn();
      renderWithAnalyticsHost(<ControlledDrawer onTabChange={onTabChange} />);
      const tabs = screen.getByRole("tablist", { name: "Widget editor" });
      const code = within(tabs).getByRole("tab", { name: "Code" });
      const queries = within(tabs).getByRole("tab", { name: "Queries (1)" });
      const user = userEvent.setup();

      expect(code).toHaveAttribute("aria-selected", "true");
      await user.click(code);
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(queries).toHaveAttribute("aria-selected", "true"));
      expect(onTabChange).toHaveBeenLastCalledWith("queries");
      expect(code).toHaveAttribute("aria-selected", "false");
      expect(screen.getByRole("tabpanel", { name: "Queries (1)" })).toBeVisible();
      expect(screen.getByTestId("code-editor")).not.toBeVisible();
      expect(screen.getByTestId("queries-panel")).toBeVisible();

      await user.keyboard("{Home}");
      await waitFor(() => expect(code).toHaveAttribute("aria-selected", "true"));
      await user.keyboard("{End}");
      await waitFor(() => expect(queries).toHaveAttribute("aria-selected", "true"));
    });

    it("keeps both editors mounted while switching, so their state survives", async () => {
      renderWithAnalyticsHost(<ControlledDrawer onTabChange={vi.fn()} />);
      const tabs = screen.getByRole("tablist", { name: "Widget editor" });
      const user = userEvent.setup();
      const mountOf = (testId: string) => screen.getByTestId(testId).getAttribute("data-mount");
      const codeMount = mountOf("code-editor");
      const queriesMount = mountOf("queries-panel");

      await user.click(within(tabs).getByRole("tab", { name: "Queries (1)" }));
      await user.click(within(tabs).getByRole("tab", { name: "Code" }));
      await user.click(within(tabs).getByRole("tab", { name: "Queries (1)" }));

      expect(mountOf("code-editor")).toBe(codeMount);
      expect(mountOf("queries-panel")).toBe(queriesMount);
    });
  });

  describe("when adding a query", () => {
    it("is left out on the Code tab", () => {
      renderDrawer();

      expect(screen.queryByRole("button", { name: /Add query/ })).toBeNull();
    });

    it("calls back with the next free name and empty SQL, outside the tablist", () => {
      const props = renderDrawer({ activeTab: "queries" });

      const add = screen.getByRole("button", { name: /Add query/ });
      expect(
        within(screen.getByRole("tablist")).queryByRole("button", { name: /Add query/ }),
      ).toBeNull();
      fireEvent.click(add);

      expect(props.onQueriesChange).toHaveBeenCalledWith([
        { name: "query1", sql: "select 1" },
        { name: "query2", sql: "" },
      ]);
    });
  });

  describe("Save", () => {
    it("saves from the footer once the draft is changed and valid", () => {
      const props = renderDrawer();

      const save = screen.getByTestId("analytics-widget-save");
      expect(save).toBeEnabled();
      fireEvent.click(save);

      expect(props.onSave).toHaveBeenCalledTimes(1);
    });

    it.each(blockedSaves)(
      "is disabled with its reason when $case",
      async ({ overrides, reason }) => {
        const props = renderDrawer(overrides);

        const save = screen.getByTestId("analytics-widget-save");
        expect(save).toBeDisabled();
        const explanation = screen.getByLabelText(reason);
        explanation.focus();
        expect(explanation).toHaveFocus();
        await userEvent.setup().hover(explanation);
        expect(await screen.findByRole("tooltip")).toHaveTextContent(reason);
        fireEvent.click(save);
        expect(props.onSave).not.toHaveBeenCalled();
      },
    );

    it("waits while saving", () => {
      const props = renderDrawer({ isSaving: true });

      const save = screen.getByTestId("analytics-widget-save");
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(props.onSave).not.toHaveBeenCalled();
    });
  });

  describe("Cancel", () => {
    it("closes once, from the button that carries the stable test id", () => {
      const props = renderDrawer();

      const cancel = screen.getByTestId("analytics-widget-cancel");
      expect(cancel).toBe(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(cancel);

      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("waits while saving", () => {
      const props = renderDrawer({ isSaving: true });

      const cancel = screen.getByTestId("analytics-widget-cancel");
      expect(cancel).toBe(screen.getByRole("button", { name: "Cancel" }));
      expect(cancel).toBeDisabled();
      fireEvent.click(cancel);
      expect(props.onClose).not.toHaveBeenCalled();
    });
  });
});

describe("the widget editor's code frame", () => {
  /** @scenario "The code editor is framed by the shared frame card" */
  it("stands the code editor inside one frame-fill card, and the Queries tab has none", () => {
    renderDrawer();

    const editor = screen.getByTestId("code-editor");
    const frame = editor.closest("[data-card-variant]");
    expect(frame).toHaveAttribute("data-card-variant", "frame-fill");
    expect(frame).toHaveAttribute("data-card-padding", "none");
    expect(screen.getByTestId("queries-panel").closest("[data-card-variant]")).toBeNull();
  });
});

describe("the overview's custom dashboard tiles", () => {
  /** @scenario "A dashboard tile is one link named for the dashboard" */
  it("draws each dashboard as one link named for it", () => {
    renderWithAnalyticsHost(<CustomReportsSection slug="test-project" />);

    const link = screen.getByRole("link", { name: "Open Latency" });
    expect(link).toHaveAttribute("href", "/test-project/analytics/reports?dashboard=dash-1");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(link.closest("[data-card-variant]")).toBeInTheDocument();
  });

  /** @scenario "Choosing a dashboard tile goes to the dashboard once" */
  it("goes to the dashboard through the host once, and leaves a new-tab click to the browser", async () => {
    const { host } = renderWithAnalyticsHost(<CustomReportsSection slug="test-project" />);
    const link = screen.getByRole("link", { name: "Open Latency" });

    await userEvent.setup().click(link);
    expect(host.navigations).toEqual(["/test-project/analytics/reports?dashboard=dash-1"]);

    const stopJsdomNavigation = (event: Event) => event.preventDefault();
    document.addEventListener("click", stopJsdomNavigation);
    fireEvent.click(link, { ctrlKey: true });
    document.removeEventListener("click", stopJsdomNavigation);
    expect(host.navigations).toHaveLength(1);
  });
});

describe("the rich-summary metric tabs", () => {
  describe.each([
    { name: "LLM metrics", view: <LLMMetrics />, tabCount: 3, hiddenGraph: "totalCostGraph" },
    { name: "User metrics", view: <UserMetrics />, tabCount: 3, hiddenGraph: "threadsCountGraph" },
  ])("given the $name tab card", ({ view, tabCount, hiddenGraph }) => {
    it("relates each tab to its panel and moves focus with arrows, Home and End", async () => {
      renderWithAnalyticsHost(view);
      const tabs = screen.getAllByRole("tab");
      expect(tabs).toHaveLength(tabCount);
      const user = userEvent.setup();

      expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
        "true",
        "false",
        "false",
      ]);
      const panel = screen.getByRole("tabpanel");
      expect(panel.id).toBe(tabs[0]?.getAttribute("aria-controls"));
      expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);

      tabs[0]?.focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(tabs[1]).toHaveFocus());
      await user.keyboard("{End}");
      await waitFor(() => expect(tabs[2]).toHaveFocus());
      await user.keyboard("{Home}");
      await waitFor(() => expect(tabs[0]).toHaveFocus());
    });

    it("activates a tab on Enter, not on arrow focus, as before", async () => {
      renderWithAnalyticsHost(view);
      const tabs = screen.getAllByRole("tab");
      const user = userEvent.setup();

      tabs[0]?.focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(tabs[1]).toHaveFocus());
      expect(tabs[1]).toHaveAttribute("aria-selected", "false");
      await user.keyboard("{Enter}");

      await waitFor(() => expect(tabs[1]).toHaveAttribute("aria-selected", "true"));
      await waitFor(() =>
        expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[1]?.id),
      );
    });

    it("keeps only the open panel in the document, so a closed graph holds no query", async () => {
      renderWithAnalyticsHost(view);
      const tabs = screen.getAllByRole("tab");
      const user = userEvent.setup();

      const openPanel = () => within(screen.getByRole("tabpanel"));
      const openGraph = openPanel()
        .getByTestId(/^graph-/)
        .getAttribute("data-testid");
      expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(1);
      expect(screen.queryByTestId(`graph-${hiddenGraph}`)).toBeNull();

      await user.click(tabs[1]!);

      await waitFor(() => expect(openPanel().queryByTestId(openGraph ?? "")).toBeNull());
      expect(openPanel().getByTestId(/^graph-/)).toBeInTheDocument();
      expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(1);
    });
  });

  it("leaves the cost tab out without the cost:view permission", () => {
    renderWithAnalyticsHost(<LLMMetrics />, { permissions: ["analytics:view"] });

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByText("Total cost")).toBeNull();
  });
});
