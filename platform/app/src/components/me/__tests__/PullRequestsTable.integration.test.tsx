/**
 * @vitest-environment jsdom
 *
 * The personal Pull Requests table: what a viewer is told when GitHub is not
 * connected, what a repository the connection does not cover is offered, how a
 * status is drawn, and how the list narrows by search, period and sort.
 *
 * The tRPC surface is a proxy that answers every query empty unless a test
 * pins it, so the table's two reads (the usage rollup and the live status)
 * are the only wiring under test.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    const useQuery = (input: unknown) => (queryImpls[path] ?? defaultQuery)(input);
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
      permission === "organization:manage" ? permissionsRef.canManageOrganization : true,
    isLoading: false,
    isFetched: true,
  }),
}));

import { PullRequestsTable } from "../PullRequestsTable";

const INSTALL_URL = "/api/github/install?organizationId=org-1";

/** A fixed moment the fixtures hang off, well outside any relative preset. */
const LONG_AGO = Date.parse("2026-07-01T09:00:00Z");

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** GitHub has been asked and has not answered yet. */
function pinStatusesPending() {
  queryImpls["github.pullRequestLiveStatus"] = () => ({
    data: undefined,
    isLoading: true,
    isError: false,
    isFetched: false,
  });
}

/**
 * Every property that could set one cell's value apart from another's, read
 * off the element as the browser resolved it. Compared whole rather than
 * property by property, so a color branch reintroduced under any name is
 * caught rather than only the one property a test happened to name.
 */
function renderedStyleOf(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontWeight: style.fontWeight,
    textDecoration: style.textDecoration,
    opacity: style.opacity,
  };
}

/**
 * A fresh element every call. React bails out of a re-render handed the very
 * same element object, so a shared constant would make `rerender` a no-op and
 * the shrinking-rows case would pass without re-reading anything.
 */
const tableElement = () => (
  <ChakraProvider value={defaultSystem}>
    <PullRequestsTable projectId="proj-personal" />
  </ChakraProvider>
);

function renderTable() {
  return render(tableElement());
}

/**
 * Tab until the element holds focus, the way a keyboard reader reaches it, or
 * give up once the whole order has been walked. Walking the real focus order is
 * the point: calling `focus()` would prove the element accepts focus without
 * proving anything can get to it. The budget covers the toolbar and every
 * sortable heading, which all come before the first row.
 */
async function tabTo({
  user,
  element,
}: {
  user: ReturnType<typeof userEvent.setup>;
  element: HTMLElement;
}) {
  for (let step = 0; step < 60 && document.activeElement !== element; step++) {
    await user.tab();
  }
}

/** The pull request numbers the table is currently drawing, top to bottom. */
const listedNumbers = () =>
  Array.from(document.querySelectorAll("tbody tr")).map(
    (row) => row.querySelector("td")?.textContent ?? "",
  );

/** The heading cell a sortable column announces its state on. */
const headingFor = (label: string) =>
  screen.getByRole("button", { name: `Sort by ${label}` }).closest("th") as HTMLElement;

/** What a case may pin about a row's money, and what is derived from it. */
type CostOverrides = {
  costUsd?: number;
  billedCostUsd?: number;
  nonBilledCostUsd?: number;
};

/**
 * The three cost numbers a row carries, resolved so they always add up: billed
 * is what the total leaves once the bundled part is taken out, unless a case
 * pins it. A case that pins only the total therefore cannot state a billed
 * figure larger than what was spent.
 */
function costSplit({
  over,
  defaultCostUsd,
}: {
  over: CostOverrides;
  defaultCostUsd: number;
}) {
  const costUsd = over.costUsd ?? defaultCostUsd;
  const nonBilledCostUsd = over.nonBilledCostUsd ?? 0;
  return {
    costUsd,
    nonBilledCostUsd,
    billedCostUsd: over.billedCostUsd ?? costUsd - nonBilledCostUsd,
  };
}

/** One mapped pull request row, filled in around whatever a case pins. */
function mappedRow(over: Record<string, unknown> & CostOverrides = {}) {
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
    prCreatedAtMs: LONG_AGO,
    prClosedAtMs: null,
    prMergedAtMs: null,
    lastActivityAtMs: LONG_AGO,
    sessionsCount: 6,
    inputTokens: 1_000,
    outputTokens: 2_000,
    cacheReadTokens: 3_000,
    cacheCreationTokens: 4_000,
    totalTokens: 10_000,
    modelBreakdown: [],
    contributorsSummary: [],
    ...over,
    ...costSplit({ over, defaultCostUsd: 12.5 }),
  };
}

/** One unlinked branch rollup. */
function unlinkedRow(over: Record<string, unknown> & CostOverrides = {}) {
  return {
    repositoryHost: "github.com",
    repositoryFullName: "acme/widgets",
    headBranch: "feat/git-context",
    lastActivityAtMs: LONG_AGO,
    sessionsCount: 3,
    totalTokens: 1_240_000,
    modelBreakdown: [],
    repoCovered: false,
    ...over,
    ...costSplit({ over, defaultCostUsd: 4.25 }),
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

    /** @scenario "An uncovered repository invites linking right on its row" */
    it("puts the invitation on the row itself, disabled for a member who may not act on it", async () => {
      const user = userEvent.setup();
      renderTable();

      const invitation = screen.getByText("Link this repo");
      expect(invitation.closest("a")).toHaveAttribute("href", INSTALL_URL);

      // The row is the shortcut, not the replacement: the overflow menu still
      // carries the same offer.
      await user.click(
        screen.getByRole("button", { name: "Actions for feat/git-context" }),
      );
      expect(await screen.findByText("Link this repository")).toBeInTheDocument();

      cleanup();
      permissionsRef.canManageOrganization = false;
      renderTable();

      const disabled = screen.getByText("Link this repo");
      expect(disabled.closest("a")).toBeNull();
      expect(disabled.closest("button")).toBeDisabled();

      await user.hover(disabled.closest("span[tabindex]") as HTMLElement);
      expect(
        await screen.findByText("Ask an administrator to link this repository."),
      ).toBeInTheDocument();

      // The button is inert, so the click lands on its wrapper; it must stop
      // there rather than fall through and open whatever the row opens.
      await user.click(disabled.closest("span[tabindex]") as HTMLElement);
      expect(mockOpenDrawer).not.toHaveBeenCalled();
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
      expect(screen.getByText("Link sessions to pull requests")).toBeInTheDocument();
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

  describe("given pull requests in each of GitHub's four states", () => {
    /** @scenario "A pull request's status carries GitHub's own color and mark" */
    it("names each state and carries its mark, drawn solid", () => {
      pinUsage({
        rows: [
          mappedRow({ prNumber: 1, state: "open", isDraft: false }),
          mappedRow({ prNumber: 2, state: "open", isDraft: true }),
          mappedRow({
            prNumber: 3,
            state: "closed",
            prMergedAtMs: Date.parse("2026-06-20T09:00:00Z"),
            prClosedAtMs: Date.parse("2026-06-20T09:00:00Z"),
          }),
          mappedRow({
            prNumber: 4,
            state: "closed",
            prClosedAtMs: Date.parse("2026-06-21T09:00:00Z"),
          }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });

      renderTable();

      for (const [label, status] of [
        ["Open", "open"],
        ["Draft", "draft"],
        ["Merged", "merged"],
        ["Closed", "closed"],
      ] as const) {
        const badge = screen.getByText(label);
        expect(badge).toHaveAttribute("data-status", status);
        // GitHub's own mark for the state, beside the word.
        expect(badge.querySelector("svg")).not.toBeNull();
        // The drawn-back outline belongs to the snapshot alone: these are the
        // states as GitHub itself draws them.
        expect(badge).toHaveAttribute("data-status-source", "payload");
      }
    });
  });

  describe("given a pull request whose live status has not arrived yet", () => {
    /** @scenario "A status shows from the stored snapshot before GitHub answers, and the live answer takes over" */
    it("shows the stored status straight away and swaps in the live one", () => {
      pinUsage({
        rows: [mappedRow({ state: "open", isDraft: false })],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      pinStatusesPending();

      const { rerender } = renderTable();

      const stored = screen.getByText("Open");
      expect(stored).toHaveAttribute("data-status-source", "payload");
      expect(stored).toHaveAttribute("data-status", "open");

      pinStatuses([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 4218,
          status: "merged",
          source: "live",
          mappedAt: null,
        },
      ]);
      rerender(tableElement());

      expect(screen.queryByText("Open")).not.toBeInTheDocument();
      const live = screen.getByText("Merged");
      expect(live).toHaveAttribute("data-status-source", "live");
    });
  });

  describe("given a row whose cost is partly not billed", () => {
    /** @scenario "A bundled token cost reads like every other token cost" */
    it("draws the value exactly like a billed one and keeps the split to the tooltip", async () => {
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

      const bundled = screen.getByText("$12.50");
      const billed = screen.getByText("$4.00");
      // Whatever the styling of a number in this column is, the two are the
      // same number to a reader: any branch that sets one apart from the other
      // fails here, whichever property it reaches for.
      expect(renderedStyleOf(bundled)).toEqual(renderedStyleOf(billed));
      expect(document.body.textContent).not.toContain("Non-billed");

      // The split is real and still reachable, one hover away.
      await user.hover(bundled);
      expect(await screen.findByText("Non-billed")).toBeInTheDocument();
      expect(await screen.findByText("Billed")).toBeInTheDocument();
      expect(
        await screen.findByText(/of the p95 of the visible pull requests/i),
      ).toBeInTheDocument();
    });
  });

  describe("given a reader who navigates by keyboard", () => {
    /** @scenario "A comparison is reachable without a pointer" */
    it("reaches a numeric column's comparison and opens it on focus", async () => {
      pinUsage({
        rows: [
          mappedRow(),
          mappedRow({ prNumber: 4219, totalTokens: 5_000, costUsd: 4 }),
          mappedRow({ prNumber: 4220, totalTokens: 2_000, costUsd: 1 }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();
      renderTable();

      const trigger = screen.getByText("10.0K").closest("[tabindex]");
      expect(trigger).toHaveAttribute("tabindex", "0");
      await tabTo({ user, element: trigger as HTMLElement });

      expect(document.activeElement).toBe(trigger);
      expect(
        await screen.findByText(/of the p95 of the visible pull requests/i),
      ).toBeInTheDocument();
    });

    /** @scenario "Sorting is operable from the keyboard and announced to assistive readers" */
    it("sorts from a heading without a pointer and announces the column and direction", async () => {
      // The three orders are deliberately all different, so returning to the
      // default is a real return rather than the input order coming back.
      pinUsage({
        rows: [
          mappedRow({
            prNumber: 4218,
            totalTokens: 5_000,
            lastActivityAtMs: LONG_AGO - 3_000,
          }),
          mappedRow({
            prNumber: 4219,
            totalTokens: 900_000,
            lastActivityAtMs: LONG_AGO - 2_000,
          }),
          mappedRow({
            prNumber: 4220,
            totalTokens: 20_000,
            lastActivityAtMs: LONG_AGO - 1_000,
          }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();
      renderTable();

      // The table opens ordered by its last update, and says so.
      expect(headingFor("Last update")).toHaveAttribute("aria-sort", "descending");
      expect(headingFor("Tokens")).toHaveAttribute("aria-sort", "none");
      const opening = listedNumbers();
      expect(opening).toEqual(["#4220", "#4219", "#4218"]);

      const tokens = screen.getByRole("button", { name: "Sort by Tokens" });
      await tabTo({ user, element: tokens });
      expect(document.activeElement).toBe(tokens);

      await user.keyboard("{Enter}");
      expect(headingFor("Tokens")).toHaveAttribute("aria-sort", "descending");
      expect(headingFor("Last update")).toHaveAttribute("aria-sort", "none");
      expect(listedNumbers()).toEqual(["#4219", "#4220", "#4218"]);

      await user.keyboard("{Enter}");
      expect(headingFor("Tokens")).toHaveAttribute("aria-sort", "ascending");
      expect(listedNumbers()).toEqual(["#4218", "#4220", "#4219"]);

      // A third choice hands the table back the order it opened in.
      await user.keyboard("{Enter}");
      expect(headingFor("Tokens")).toHaveAttribute("aria-sort", "none");
      expect(headingFor("Last update")).toHaveAttribute("aria-sort", "descending");
      expect(listedNumbers()).toEqual(opening);
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
    beforeEach(() => {
      pinUsage({
        rows: [],
        unlinked: [unlinkedRow()],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    /** @scenario "A branch with no pull request opens nothing" */
    it("opens no detail when the row is clicked", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("feat/git-context"));

      expect(mockOpenDrawer).not.toHaveBeenCalled();
      expect(screen.queryByText("No pull request yet")).not.toBeInTheDocument();
      expect(screen.getByText("No PR yet")).toBeInTheDocument();
    });

    /** @scenario "A branch with no pull request says No PR yet in the status column" */
    it("says No PR yet rather than borrowing a pull request state", () => {
      renderTable();

      expect(screen.getByText("No PR yet")).toBeInTheDocument();
      // No badge at all: an absent pull request has no state to report, and a
      // gray "Draft" or "Closed" would be a claim about one that never existed.
      expect(document.querySelector("[data-status]")).toBeNull();
    });

    /** @scenario "A branch row reports the models its sessions ran" */
    it("names the models its sessions ran", () => {
      pinUsage({
        rows: [],
        unlinked: [
          unlinkedRow({
            modelBreakdown: [
              { model: "claude-opus-5", tokensKnown: false },
              { model: "claude-haiku-4-5-20251001", tokensKnown: false },
            ],
          }),
        ],
        connection: { connected: true, installUrl: INSTALL_URL },
      });

      renderTable();

      // The leading model, and the count of the rest, exactly as a mapped row
      // reads: a branch has no per-call totals, not no models.
      expect(screen.getByText("claude-opus-5 +1")).toBeInTheDocument();
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
            lastActivityAtMs: LONG_AGO - index * 1000,
          }),
        ),
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();
      renderTable();

      fireEvent.change(screen.getByTestId("pagination-page-size"), {
        target: { value: "10" },
      });
      expect(screen.getByText("Pull request 0")).toBeInTheDocument();
      expect(screen.queryByText("Pull request 11")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /next/i }));

      expect(screen.getByText("Pull request 11")).toBeInTheDocument();
      expect(screen.queryByText("Pull request 0")).not.toBeInTheDocument();
    });
  });

  describe("given the rows shrink under the page the reader is on", () => {
    /** @scenario "A page beyond the last one falls back rather than emptying the table" */
    it("falls back to the last page that still has rows rather than showing none", async () => {
      const pullRequests = Array.from({ length: 12 }, (_, index) =>
        mappedRow({
          prNumber: 5000 + index,
          title: `Pull request ${index}`,
          lastActivityAtMs: LONG_AGO - index * 1000,
        }),
      );
      pinUsage({
        rows: pullRequests,
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      const user = userEvent.setup();
      const { rerender } = renderTable();

      fireEvent.change(screen.getByTestId("pagination-page-size"), {
        target: { value: "10" },
      });
      await user.click(screen.getByRole("button", { name: /next/i }));
      expect(screen.getByText("Pull request 11")).toBeInTheDocument();

      // A refetch that drops rows leaves the reader on a page past the end.
      pinUsage({
        rows: pullRequests.slice(0, 3),
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      rerender(tableElement());

      expect(screen.getByText("Pull request 0")).toBeInTheDocument();
      expect(screen.getByTestId("pagination-indicator")).toHaveTextContent(
        "3 pull requests · showing 1–3",
      );
    });
  });

  describe("given a row whose models are known", () => {
    it("names the leading model and how many others rode along", () => {
      pinUsage({
        rows: [
          mappedRow({
            modelBreakdown: [
              { model: "claude-fable-5", totalTokens: 8_000, costUsd: 10 },
              { model: "gpt-5-mini", totalTokens: 2_000, costUsd: 2.5 },
            ],
          }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
      renderTable();

      expect(screen.getByText("claude-fable-5 +1")).toBeInTheDocument();
    });
  });

  describe("given rows differing in number, title, branch and repository", () => {
    beforeEach(() => {
      pinUsage({
        rows: [
          mappedRow(),
          mappedRow({
            prNumber: 7001,
            title: "Retry the ingestion queue",
            headBranch: "fix/queue-retry",
            repositoryFullName: "acme/gateway",
            htmlUrl: "https://github.com/acme/gateway/pull/7001",
          }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    /** @scenario "Search matches number, title, branch and repository regardless of case" */
    it("keeps every row matching on any of the four, in any casing", async () => {
      const user = userEvent.setup();
      renderTable();

      const search = screen.getByRole("searchbox");
      const listed = () => screen.queryByText("Link sessions to pull requests");
      const other = () => screen.queryByText("Retry the ingestion queue");

      for (const numeric of ["#4218", "4218"]) {
        await user.clear(search);
        await user.type(search, numeric);
        expect(listed()).toBeInTheDocument();
        expect(other()).not.toBeInTheDocument();
      }

      await user.clear(search);
      await user.type(search, "RETRY THE INGESTION");
      expect(other()).toBeInTheDocument();
      expect(listed()).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "GIT-CONTEXT");
      expect(listed()).toBeInTheDocument();
      expect(other()).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "acme/GATEWAY");
      expect(other()).toBeInTheDocument();
      expect(listed()).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "nothing here");
      expect(screen.getByText("No pull requests match")).toBeInTheDocument();
      // The way back is where the reader left it.
      expect(screen.getByRole("searchbox")).toHaveValue("nothing here");
    });
  });

  describe("given rows last updated at different times", () => {
    beforeEach(() => {
      pinUsage({
        rows: [
          mappedRow({
            prNumber: 8001,
            title: "Worked on this morning",
            lastActivityAtMs: Date.now() - 2 * 60 * 60 * 1000,
          }),
          mappedRow({
            prNumber: 8002,
            title: "Untouched for a month",
            lastActivityAtMs: Date.now() - 40 * DAY_MS,
          }),
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    /** @scenario "A period keeps only rows whose last update falls inside it" */
    it("lists only the rows last updated inside the chosen period", async () => {
      const user = userEvent.setup();
      renderTable();

      expect(screen.getByText("Untouched for a month")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /all time/i }));
      await user.click(await screen.findByText("Last 7 days"));

      expect(screen.getByText("Worked on this morning")).toBeInTheDocument();
      expect(screen.queryByText("Untouched for a month")).not.toBeInTheDocument();
    });

    /** @scenario "The period starts at all time and can return to it" */
    it("opens on all time and widens back to it once narrowed", async () => {
      const user = userEvent.setup();
      renderTable();

      // Nothing is hidden until the reader asks for a window.
      expect(screen.getByRole("button", { name: /all time/i })).toBeVisible();
      expect(screen.getByText("Untouched for a month")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /all time/i }));
      await user.click(await screen.findByText("Last 7 days"));
      expect(screen.queryByText("Untouched for a month")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /last 7 days/i }));
      await user.click(await screen.findByRole("button", { name: "All time" }));

      expect(screen.getByText("Untouched for a month")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /all time/i })).toBeVisible();
    });
  });
});
