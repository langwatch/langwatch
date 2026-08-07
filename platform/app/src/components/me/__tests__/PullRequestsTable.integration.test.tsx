/**
 * @vitest-environment jsdom
 *
 * The personal Pull Requests table: what a viewer is told when GitHub is not
 * connected, and what a repository the connection does not cover is offered.
 *
 * The tRPC surface is a proxy that answers every query empty unless a test
 * pins it, so the table's two reads (the usage rollup and the live status)
 * are the only wiring under test.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { queryImpls, permissionsRef, mockOpenDrawer } = vi.hoisted(() => ({
  queryImpls: {} as Record<string, (input: unknown) => unknown>,
  permissionsRef: { canManageOrganization: true },
  mockOpenDrawer: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mockOpenDrawer, closeDrawer: vi.fn() }),
}));

vi.mock("~/utils/api", () => {
  const defaultQuery = () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetched: true,
  });
  const hooksFor = (path: string): Map<string, unknown> => {
    const useQuery = (input: unknown) =>
      (queryImpls[path] ?? defaultQuery)(input);
    return new Map<string, unknown>([
      ["useQuery", useQuery],
      ["useInfiniteQuery", useQuery],
    ]);
  };
  const makeNode = (path: string): unknown => {
    const hooks = hooksFor(path);
    return new Proxy(
      {},
      {
        get: (_target, prop) =>
          typeof prop === "string"
            ? (hooks.get(prop) ?? makeNode(path ? `${path}.${prop}` : prop))
            : undefined,
      },
    );
  };
  return { api: makeNode("") };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme" },
    organizations: [],
    project: undefined,
    team: undefined,
    hasPermission: (permission: string) =>
      permission === "organization:manage"
        ? permissionsRef.canManageOrganization
        : true,
    isLoading: false,
    isFetched: true,
  }),
}));

import { PullRequestsTable } from "../PullRequestsTable";

const INSTALL_URL = "/api/github/install?organizationId=org-1";

function pinUsage(data: unknown) {
  queryImpls["codingAgents.pullRequestUsage"] = () => ({
    data,
    isLoading: false,
    isError: false,
    isFetched: true,
  });
}

function pinStatuses(statuses: unknown[]) {
  queryImpls["github.pullRequestLiveStatus"] = () => ({
    data: { statuses },
    isLoading: false,
    isError: false,
    isFetched: true,
  });
}

function renderTable() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PullRequestsTable projectId="proj-personal" />
    </ChakraProvider>,
  );
}

/** One mapped pull request row, filled in around whatever a case pins. */
function mappedRow(over: Record<string, unknown> = {}) {
  return {
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    prNumber: 4218,
    title: "Link sessions to pull requests",
    headBranch: "feat/git-context",
    htmlUrl: "https://github.com/acme/widgets/pull/4218",
    state: "open",
    isDraft: false,
    authorLogin: "acme-dev",
    prCreatedAtMs: Date.parse("2026-07-01T09:00:00Z"),
    prClosedAtMs: null,
    prMergedAtMs: null,
    sessionsCount: 6,
    inputTokens: 1_000,
    outputTokens: 2_000,
    cacheReadTokens: 3_000,
    cacheCreationTokens: 4_000,
    totalTokens: 10_000,
    costUsd: 12.5,
    billedCostUsd: 12.5,
    nonBilledCostUsd: 0,
    modelBreakdown: [],
    contributorsSummary: [],
    ...over,
  };
}

/** One unlinked branch rollup. */
function unlinkedRow(over: Record<string, unknown> = {}) {
  return {
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    headBranch: "feat/git-context",
    sessionsCount: 3,
    totalTokens: 1_240_000,
    costUsd: 4.25,
    billedCostUsd: 4.25,
    nonBilledCostUsd: 0,
    repoCovered: false,
    ...over,
  };
}

beforeEach(() => {
  for (const key of Object.keys(queryImpls)) delete queryImpls[key];
  permissionsRef.canManageOrganization = true;
  mockOpenDrawer.mockClear();
  pinStatuses([]);
});

afterEach(() => {
  cleanup();
});

describe("the personal Pull Requests table", () => {
  describe("given an organization with no GitHub connection", () => {
    /** @scenario "A viewer without a GitHub connection sees the connect invitation" */
    it("invites an organization manager to connect and tells everyone else to ask an administrator", () => {
      pinUsage({
        rows: [],
        unlinked: [],
        connection: { connected: false, installUrl: INSTALL_URL },
      });

      renderTable();
      expect(screen.getByText("GitHub is not connected")).toBeInTheDocument();
      const connect = screen.getByText("Connect GitHub").closest("a");
      expect(connect).toHaveAttribute("href", INSTALL_URL);

      cleanup();
      permissionsRef.canManageOrganization = false;
      renderTable();
      expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();
      expect(screen.queryByText("Connect GitHub")).not.toBeInTheDocument();
    });
  });

  describe("given a session whose repository no installation covers", () => {
    beforeEach(() => {
      pinUsage({
        rows: [],
        unlinked: [unlinkedRow()],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    /** @scenario "A session repository not covered by the connection offers linking it" */
    it("offers an organization manager the option to link that repository", async () => {
      const user = userEvent.setup();
      renderTable();

      expect(screen.getByText("acme/widgets")).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "Actions for feat/git-context" }),
      );

      // Deep links to the GitHub App installation page, where the repository
      // is added to the organization's connection.
      const link = await screen.findByText("Link this repository");
      expect(link.closest("a")).toHaveAttribute("href", INSTALL_URL);
      expect(link.closest("[data-disabled]")).toBeNull();
    });

    it("disables linking for someone who may not manage the organization", async () => {
      permissionsRef.canManageOrganization = false;
      const user = userEvent.setup();
      renderTable();

      await user.click(
        screen.getByRole("button", { name: "Actions for feat/git-context" }),
      );

      const link = await screen.findByText("Link this repository");
      expect(link.closest("[data-disabled]")).not.toBeNull();
    });
  });

  describe("given a mapped pull request whose status came from a snapshot", () => {
    beforeEach(() => {
      pinUsage({
        rows: [mappedRow()],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    it("shows the pull request number, its totals and a live status chip", () => {
      pinStatuses([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 4218,
          status: "open",
          source: "live",
          mappedAt: new Date("2026-07-01T10:00:00Z"),
        },
      ]);

      renderTable();

      expect(screen.getByText("#4218").closest("a")).toHaveAttribute(
        "href",
        "https://github.com/acme/widgets/pull/4218",
      );
      const chip = screen.getByText("Open");
      expect(chip).toHaveAttribute("data-status-source", "live");
      expect(
        screen.getByText("Link sessions to pull requests"),
      ).toBeInTheDocument();
      // Session counts read in full; token counts step up a tier.
      expect(screen.getByText("6")).toBeInTheDocument();
      expect(screen.getByText("10.0K")).toBeInTheDocument();
      expect(screen.getByText("$12.50")).toBeInTheDocument();
    });

    it("draws a snapshot status back and says when it is from", async () => {
      pinStatuses([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 4218,
          status: "merged",
          source: "snapshot",
          mappedAt: new Date("2026-07-01T10:00:00Z"),
        },
      ]);
      const user = userEvent.setup();

      renderTable();

      // The live chip is solid; a snapshot is outlined and muted, so the two
      // never read the same at a glance.
      const chip = screen.getByText("Merged");
      expect(chip).toHaveAttribute("data-status-source", "snapshot");

      await user.hover(chip);
      const tooltip = await screen.findByText(/last known status, from/i);
      expect(tooltip).toHaveTextContent(
        new Date("2026-07-01T10:00:00Z").toLocaleDateString(),
      );
    });
  });

  describe("given a row whose cost is partly not billed", () => {
    /** @scenario "A bundled token cost reads as bundled money" */
    it("draws the value in the bundled color and explains both halves", async () => {
      pinUsage({
        rows: [
          mappedRow({
            costUsd: 12.5,
            billedCostUsd: 2.5,
            nonBilledCostUsd: 10,
          }),
          mappedRow({ prNumber: 4219, totalTokens: 5_000, costUsd: 4 }),
          mappedRow({ prNumber: 4220, totalTokens: 2_000, costUsd: 1 }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();

      renderTable();

      const value = screen.getByText("$12.50");
      // The money-nature signal lives on the value, never on the bar: the bar
      // is reserved for the comparison against the visible page.
      expect(value).toHaveStyle({ color: "var(--chakra-colors-purple-fg)" });
      // A row billed per token keeps the default color, so the two never read
      // the same.
      expect(screen.getByText("$4.00")).not.toHaveStyle({
        color: "var(--chakra-colors-purple-fg)",
      });

      await user.hover(value);
      expect(await screen.findByText("Non-billed")).toBeInTheDocument();
      expect(
        await screen.findByText(/of the p95 of the visible pull requests/i),
      ).toBeInTheDocument();
    });
  });

  describe("given a listed pull request", () => {
    beforeEach(() => {
      pinUsage({
        rows: [mappedRow()],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    /** @scenario "Opening a pull request row opens its detail" */
    it("opens the detail for that pull request when the row is clicked", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("Link sessions to pull requests"));

      expect(mockOpenDrawer).toHaveBeenCalledWith("pullRequestDetail", {
        projectId: "proj-personal",
        repositoryHost: "github.com",
        repositoryFullName: "acme/widgets",
        prNumber: 4218,
      });
    });

    it("does not open the detail when the row's actions menu is used", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(
        screen.getByRole("button", { name: "Actions for pull request 4218" }),
      );

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });

  describe("given a listed branch with no pull request", () => {
    /** @scenario "A branch with no pull request opens nothing" */
    it("opens no detail when the row is clicked", async () => {
      pinUsage({
        rows: [],
        unlinked: [unlinkedRow()],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("No pull request yet"));

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });

  describe("given more pull requests than fit on a page", () => {
    /** @scenario "The table shows one page of pull requests at a time" */
    it("lists the next pull requests when the page is changed", async () => {
      pinUsage({
        rows: Array.from({ length: 12 }, (_, index) =>
          mappedRow({
            prNumber: 5000 + index,
            title: `Pull request ${index}`,
            prCreatedAtMs: Date.parse("2026-07-01T09:00:00Z") - index * 1000,
          }),
        ),
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByTestId("pagination-size-10"));
      expect(screen.getByText("Pull request 0")).toBeInTheDocument();
      expect(screen.queryByText("Pull request 11")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /next/i }));

      expect(screen.getByText("Pull request 11")).toBeInTheDocument();
      expect(screen.queryByText("Pull request 0")).not.toBeInTheDocument();
    });
  });

  describe("given a row whose contributors and models are known", () => {
    it("names the contributors and the models behind the counts", async () => {
      pinUsage({
        rows: [
          mappedRow({
            contributorsSummary: [
              { userLabel: "Riley", projectName: "Personal", sessionsCount: 2 },
              {
                userLabel: "PR Reviewer",
                projectName: "Gateway",
                sessionsCount: 1,
              },
            ],
            modelBreakdown: [
              { model: "claude-fable-5", totalTokens: 8_000, costUsd: 10 },
              { model: "gpt-5-mini", totalTokens: 2_000, costUsd: 2.5 },
            ],
          }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();
      renderTable();

      expect(screen.getByText("claude-fable-5 +1")).toBeInTheDocument();

      await user.hover(screen.getByText("6"));
      expect(
        await screen.findByText("Riley (Personal): 2 sessions"),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("PR Reviewer (Gateway): 1 session"),
      ).toBeInTheDocument();
    });
  });
});
