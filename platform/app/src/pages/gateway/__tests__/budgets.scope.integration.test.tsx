/**
 * @vitest-environment jsdom
 *
 * The Budgets list Scope column. Every scope kind renders as the one
 * shared scope chip the rest of settings uses, on a single line: the
 * kind's icon plus the target's name, with the identifier and any
 * member count moved into the chip's tooltip. A virtual-key target is
 * the same chip made clickable, so a budget capping one key can be
 * followed to it.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/WithPermissionGuard", () => ({
  withPermissionGuard:
    () =>
    <P extends object>(Component: React.ComponentType<P>) =>
      Component,
}));

vi.mock("~/components/gateway/AiGatewayLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/gateway/BudgetCreateDrawer", () => ({
  BudgetCreateDrawer: () => null,
}));
vi.mock("~/components/gateway/BudgetEditDrawer", () => ({
  BudgetEditDrawer: () => null,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", slug: "acme", name: "ACME" },
    project: { slug: "web-app" },
    hasPermission: () => true,
  }),
}));

function budget(overrides: Record<string, unknown>) {
  return {
    id: "bdg-1",
    name: "budget",
    description: null,
    scopeType: "ORGANIZATION",
    scopeTarget: null,
    providerLabel: null,
    window: "MONTH",
    limitUsd: "100.000000",
    spentUsd: "10.000000",
    onBreach: "BLOCK",
    resetsAt: "2026-04-01T00:00:00.000Z",
    spendAvailable: true,
    unreachableByAnyKey: false,
    ...overrides,
  };
}

const BUDGETS = [
  budget({
    id: "bdg-org",
    name: "org cap",
    scopeType: "ORGANIZATION",
    scopeTarget: {
      kind: "ORGANIZATION",
      id: "org-1",
      name: "ACME",
      secondary: "acme-HXECRq",
    },
  }),
  budget({
    id: "bdg-vk",
    name: "key cap",
    scopeType: "VIRTUAL_KEY",
    scopeTarget: {
      kind: "VIRTUAL_KEY",
      id: "vk-lw-01KYC6G",
      name: "Scenario CI",
      secondary: "vk-lw-01KYC6G…",
    },
  }),
  budget({
    id: "bdg-group",
    name: "group cap",
    scopeType: "GROUP",
    scopeTarget: {
      kind: "GROUP",
      id: "grp-1",
      name: "Engineering",
      secondary: "eng",
      memberCount: 4,
    },
  }),
  // The remaining kinds the Scope column can be asked to render, so every
  // kind in the enum is exercised through the page. Which chip STYLE each
  // one gets is asserted where it is observable without a portal, in
  // budgets.scopeChipDetail.unit.test.ts.
  budget({
    id: "bdg-team",
    name: "team cap",
    scopeType: "TEAM",
    scopeTarget: { kind: "TEAM", id: "team-1", name: "Platform" },
  }),
  budget({
    id: "bdg-project",
    name: "project cap",
    scopeType: "PROJECT",
    scopeTarget: { kind: "PROJECT", id: "proj-1", name: "Web App" },
  }),
  budget({
    id: "bdg-principal",
    name: "principal cap",
    scopeType: "PRINCIPAL",
    scopeTarget: {
      kind: "PRINCIPAL",
      id: "usr-1",
      name: "Ada Lovelace",
      secondary: "ada@acme.test",
    },
  }),
  // A per-person template names the anchor its allowance hangs off, so the
  // chip carries a key's name under a kind of its own.
  budget({
    id: "bdg-attributed",
    name: "per person cap",
    scopeType: "ATTRIBUTED_USER",
    scopeTarget: {
      kind: "ATTRIBUTED_USER",
      id: "vk-lw-01KYC7H",
      name: "prod-openai",
      secondary: "vk-lw-01KYC7H…",
    },
  }),
];

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      gatewayBudgets: { list: { invalidate: vi.fn() } },
    }),
    gatewayBudgets: {
      list: {
        useQuery: () => ({
          data: { budgets: BUDGETS, spendAvailable: true },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        }),
      },
      archive: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

import BudgetsPage from "../budgets";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <BudgetsPage />
    </ChakraProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("budgets list scope column", () => {
  afterEach(() => cleanup());

  /** @scenario "Budget list Scope column renders the shared scope chip on one line" */
  it("renders an organization scope as the shared chip, name only", () => {
    renderPage();
    const row = rowFor("org cap");
    expect(within(row).getByText("ACME")).toBeInTheDocument();
    // The identifier moved into the tooltip, so it must not appear on the
    // visible line in ANY form. Matching the bare id, not the old
    // parenthesized rendering, is what makes this assertion able to fail.
    expect(within(row).queryByText(/acme-HXECRq/)).not.toBeInTheDocument();
    expect(within(row).queryByText("organization")).not.toBeInTheDocument();
  });

  /** @scenario "Budget list Scope column renders the shared scope chip on one line" */
  it("gives every other scope kind its own chip, named", () => {
    renderPage();
    expect(within(rowFor("team cap")).getByText("Platform")).toBeInTheDocument();
    expect(within(rowFor("project cap")).getByText("Web App")).toBeInTheDocument();
    const principal = rowFor("principal cap");
    expect(within(principal).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(principal).queryByText(/ada@acme\.test/)).not.toBeInTheDocument();
    const attributed = rowFor("per person cap");
    expect(within(attributed).getByText("prod-openai")).toBeInTheDocument();
    expect(within(attributed).queryByText("attributed user")).not.toBeInTheDocument();
  });

  /** @scenario "Budget list links a virtual-key scope to that key" */
  it("links a virtual-key scope to that key, by name", () => {
    renderPage();
    const row = rowFor("key cap");
    const link = within(row).getByRole("link", { name: /Scenario CI/ });
    expect(link).toHaveAttribute("href", "/gateway/virtual-keys/vk-lw-01KYC6G");
    expect(within(row).queryByText(/vk-lw-01KYC6G…/)).not.toBeInTheDocument();
  });

  /** @scenario "Budget list keeps the per-member marker on a group scope" */
  it("keeps the per-member marker on a group scope", () => {
    renderPage();
    const row = rowFor("group cap");
    expect(within(row).getByText("Engineering")).toBeInTheDocument();
    expect(within(row).getByTestId("budget-per-member-badge")).toBeInTheDocument();
  });
});
