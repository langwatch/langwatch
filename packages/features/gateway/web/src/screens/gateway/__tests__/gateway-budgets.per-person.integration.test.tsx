/**
 * @vitest-environment jsdom
 *
 * RTL coverage for how the Budgets list renders a per-person template.
 *
 * A template is one row covering many people, so a single spend total
 * describes nobody. The cell has to headline the cap each person carries
 * and report a headcount underneath, and it has to say "0 of 0" for a
 * template nobody has used rather than a dash that reads as broken.
 */
import { cleanup, screen, within } from "@testing-library/react";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listQuery = vi.hoisted(() => vi.fn());

vi.mock("../../../ui/sections/gateway-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="ai-gateway-layout">{children}</div>
  ),
}));

vi.mock("../../../features/budgets/ui/sections/budget-create-drawer", () => ({
  BudgetCreateDrawer: () => null,
}));

vi.mock("../../../features/budgets/ui/sections/budget-edit-drawer", () => ({
  BudgetEditDrawer: () => null,
}));

vi.mock("../../../behavior/gateway-api", () => ({
  api: {
    gatewayBudgets: {
      list: { useQuery: listQuery },
      archive: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    useUtils: () => ({
      gatewayBudgets: { list: { invalidate: vi.fn() } },
    }),
  },
}));

/** One organization, one project, and an admin who may manage budgets. */
const host = fakeGatewayHost({
  permissions: ["gatewayBudgets:manage"],
  organization: { id: "org_1", name: "ACME", slug: "acme", teams: [] },
  project: { id: "project_1", name: "ACME project", slug: "acme-project", teamId: "team_1" },
});

import BudgetsPage from "../gateway-budgets.screen";

function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bdg_template",
    organizationId: "org_1",
    scopeType: "ATTRIBUTED_USER",
    scopeId: "vk_anchor",
    name: "Per-seat cap",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: "1.00",
    spentUsd: "0",
    timezone: null,
    providerKey: null,
    currentPeriodStartedAt: new Date("2026-07-01T00:00:00Z").toISOString(),
    resetsAt: new Date("2026-08-01T00:00:00Z").toISOString(),
    lastResetAt: null,
    archivedAt: null,
    createdAt: new Date("2026-06-01T00:00:00Z").toISOString(),
    endUsersSeen: 10,
    endUsersOver: 3,
    spendAvailable: true,
    unreachableByAnyKey: false,
    scopeTarget: {
      kind: "ATTRIBUTED_USER",
      id: "vk_anchor",
      name: "prod-openai",
      secondary: "lw_sk_ab…",
    },
    providerLabel: null,
    ...overrides,
  };
}

function renderWith(rows: Array<Record<string, unknown>>) {
  listQuery.mockReturnValue({
    data: { budgets: rows, spendAvailable: true },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  renderWithGatewayHost(<BudgetsPage />, { host });
}

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe("the Budgets list rendering a per-person template", () => {
  /** @scenario "The budget list shows a per-person template as a cap and a headcount" */
  it("headlines the per-person cap instead of a single spend total", () => {
    renderWith([templateRow()]);

    const cell = screen.getByTestId("budget-attributed-user-spend");
    expect(within(cell).getByText("$1.00")).toBeInTheDocument();
    expect(within(cell).getByText("per person")).toBeInTheDocument();
  });

  /** @scenario "The budget list shows a per-person template as a cap and a headcount" */
  it("reads the headcount of people over their own cap", () => {
    renderWith([templateRow()]);

    expect(
      within(screen.getByTestId("budget-attributed-user-spend")).getByText(
        "3 of 10 people over cap",
      ),
    ).toBeInTheDocument();
  });

  /** @scenario "The budget list shows a per-person template as a cap and a headcount" */
  it("fills the bar to the share of people over cap and turns it red", () => {
    renderWith([templateRow()]);

    const bar = screen
      .getByTestId("budget-attributed-user-spend")
      .querySelector("[role='progressbar']");
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("data-scope", "progress");
  });

  /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
  it("says 0 of 0 for a template nobody has spent against", () => {
    renderWith([templateRow({ endUsersSeen: 0, endUsersOver: 0 })]);

    const cell = screen.getByTestId("budget-attributed-user-spend");
    expect(within(cell).getByText("0 of 0 people over cap")).toBeInTheDocument();
    expect(within(cell).queryByText("—")).toBeNull();
  });

  /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
  it("leaves the bar empty when nobody is over", () => {
    renderWith([templateRow({ endUsersSeen: 0, endUsersOver: 0 })]);

    const bar = screen
      .getByTestId("budget-attributed-user-spend")
      .querySelector("[role='progressbar']");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
  });

  /** @scenario "Budget list Scope column renders the shared scope chip on one line" */
  it("names the anchor the template hangs off in the Scope column", () => {
    renderWith([templateRow()]);

    expect(screen.getByText("prod-openai")).toBeInTheDocument();
    // The kind rides the chip's tooltip now, so the visible cell is the
    // anchor's name alone.
    expect(screen.queryByText("attributed user")).not.toBeInTheDocument();
  });

  /** @scenario "The budget list shows a per-person template as a cap and a headcount" */
  it("keeps every other scope on the spent-over-limit rendering", () => {
    renderWith([
      templateRow({
        id: "bdg_project",
        scopeType: "PROJECT",
        scopeId: "project_1",
        name: "Project cap",
        limitUsd: "100.00",
        spentUsd: "25.00",
        endUsersSeen: undefined,
        endUsersOver: undefined,
        scopeTarget: {
          kind: "PROJECT",
          id: "project_1",
          name: "acme-project",
          secondary: "acme-project",
        },
      }),
    ]);

    expect(screen.queryByTestId("budget-attributed-user-spend")).toBeNull();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
    expect(screen.getByText("/ $100.00")).toBeInTheDocument();
  });
});
