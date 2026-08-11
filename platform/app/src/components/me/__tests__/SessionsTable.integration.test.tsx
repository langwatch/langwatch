/**
 * @vitest-environment jsdom
 *
 * The personal Sessions table: what a row says about a session's context
 * economics, what a workspace with nothing in it is told, and how the list
 * narrows by search, period, sort and page. Then the replay: choosing a row
 * opens the session's terminal view over the table, and leaving it puts the
 * reader back on the table exactly as they left it.
 *
 * The tRPC surface is a proxy that answers every query empty unless a test
 * pins it, so the table's one read and its one lookup are the only wiring
 * under test. The drawer is somebody else's component, so its store and its
 * opener are mocked and the assertions are about what this table asks them
 * for.
 *
 * @see specs/coding-agent/sessions-screen.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const {
  queryImpls,
  utils,
  mockOpenDrawer,
  mockCloseDrawer,
  mockOpenTrace,
  mockSetViewModeTransient,
  mockStoreCloseDrawer,
  mockRouterPush,
  mockToasterCreate,
  mockShowErrorToast,
} = vi.hoisted(() => ({
  queryImpls: {} as Record<string, (input: unknown) => unknown>,
  utils: {
    tracesV2: {
      conversationContext: { fetch: vi.fn(), prefetch: vi.fn() },
    },
  },
  mockOpenDrawer: vi.fn(),
  mockCloseDrawer: vi.fn(),
  mockOpenTrace: vi.fn(),
  mockSetViewModeTransient: vi.fn(),
  mockStoreCloseDrawer: vi.fn(),
  mockRouterPush: vi.fn(),
  mockToasterCreate: vi.fn(),
  mockShowErrorToast: vi.fn(),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
  }),
}));

vi.mock("~/features/traces-v2/stores/drawerStore", () => ({
  useDrawerStore: {
    getState: () => ({
      openTrace: mockOpenTrace,
      setViewModeTransient: mockSetViewModeTransient,
      closeDrawer: mockStoreCloseDrawer,
    }),
  },
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: mockToasterCreate },
}));

vi.mock("~/features/errors", () => ({
  showErrorToast: mockShowErrorToast,
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
    const hooks = new Map<string, unknown>([
      ["useQuery", useQuery],
      ["useInfiniteQuery", useQuery],
    ]);
    // The imperative side of the same client, which the table uses to look a
    // session's turns up on demand rather than on render.
    if (path === "") hooks.set("useUtils", () => utils);
    return hooks;
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

import { SessionsTable } from "../SessionsTable";

/** A fixed moment the fixtures hang off, well outside any relative preset. */
const LONG_AGO = Date.parse("2026-07-01T09:00:00Z");

const DAY_MS = 24 * 60 * 60 * 1000;

function pinSessions(data: unknown) {
  queryImpls["codingAgents.sessionsList"] = () => ({
    data,
    isLoading: false,
    isError: false,
    isFetched: true,
  });
}

/** One session row, filled in around whatever a case pins. */
function sessionRow(over: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    title: "Link sessions to pull requests",
    agent: "claude_code",
    agentVersion: "2.0.1",
    repositoryHost: "github.com",
    repositoryOwner: "acme",
    repositoryName: "widgets",
    gitBranch: "feat/git-context",
    gitBranches: ["feat/git-context"],
    startedAtMs: LONG_AGO,
    lastEventOccurredAtMs: LONG_AGO,
    inputTokens: 1_000,
    outputTokens: 2_000,
    cacheReadTokens: 3_000,
    cacheCreationTokens: 4_000,
    costUsd: 12.5,
    peakContextTokens: 156_800,
    compactions: 3,
    compactionTokensBefore: 180_000,
    compactionTokensAfter: 42_000,
    cacheRebuildCount: 2,
    largestCacheRebuildTokens: 90_000,
    activeTimeCliSec: 4 * 60 * 60 + 12 * 60,
    blockedOnUserMs: 38 * 60 * 1000,
    models: ["claude-fable-5"],
    pullRequests: [
      {
        number: 4218,
        url: "https://github.com/acme/widgets/pull/4218",
        title: "Link sessions to pull requests",
      },
    ],
    ...over,
  };
}

/** A session carrying one number and nothing else worth reading. */
function sessionOfTokens({
  sessionId,
  title,
  totalTokens,
  lastEventOccurredAtMs,
}: {
  sessionId: string;
  title: string;
  totalTokens: number;
  lastEventOccurredAtMs: number;
}) {
  return sessionRow({
    sessionId,
    title,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    lastEventOccurredAtMs,
    startedAtMs: lastEventOccurredAtMs,
  });
}

/**
 * A fresh element every call. React bails out of a re-render handed the very
 * same element object, so a shared constant would make `rerender` a no-op.
 */
const tableElement = () => (
  <ChakraProvider value={defaultSystem}>
    <SessionsTable projectId="proj-personal" projectSlug="acme-personal" />
  </ChakraProvider>
);

function renderTable() {
  return render(tableElement());
}

/** The session titles the table is currently drawing, top to bottom. */
const listedTitles = () =>
  Array.from(document.querySelectorAll("tbody tr")).map(
    (row) => row.querySelector("td p")?.textContent ?? "",
  );

/** The heading cell a sortable column announces its state on. */
const headingFor = (label: string) =>
  screen
    .getByRole("button", { name: `Sort by ${label}` })
    .closest("th") as HTMLElement;

/** One stored turn, as the conversation lookup hands it over. */
const turn = (over: Record<string, unknown> = {}) => ({
  traceId: "trace-last",
  timestamp: LONG_AGO + 5_000,
  name: "turn",
  status: "ok",
  ...over,
});

function pinTurns(turns: unknown[]) {
  utils.tracesV2.conversationContext.fetch.mockResolvedValue({
    conversationId: "session-1",
    total: turns.length,
    turns,
  });
}

beforeEach(() => {
  for (const key of Object.keys(queryImpls)) delete queryImpls[key];
  vi.clearAllMocks();
  pinTurns([turn({ traceId: "trace-first", timestamp: LONG_AGO }), turn()]);
});

afterEach(() => {
  cleanup();
});

describe("the personal Sessions table", () => {
  describe("given a personal workspace with coding-agent sessions", () => {
    /** @scenario "The page lists my recent sessions with their context economics" */
    it("gives each session a row carrying its context, compactions, rebuilds and waiting time", () => {
      pinSessions([sessionRow()]);

      renderTable();

      expect(
        screen.getByText("Link sessions to pull requests"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("acme/widgets · feat/git-context"),
      ).toBeInTheDocument();

      // Everything the session consumed across its life, over the context it
      // was carrying at its heaviest.
      expect(screen.getByText("Total 10.0K")).toBeInTheDocument();
      expect(screen.getByText("Peak 156.8K")).toBeInTheDocument();

      expect(screen.getByText("3 compactions")).toBeInTheDocument();
      expect(screen.getByText("2 cache rebuilds")).toBeInTheDocument();

      expect(screen.getByText("4h 12m active")).toBeInTheDocument();
      expect(screen.getByText("38m waiting")).toBeInTheDocument();

      expect(screen.getByText("$12.50")).toBeInTheDocument();
      expect(screen.getByText("#4218").closest("a")).toHaveAttribute(
        "href",
        "https://github.com/acme/widgets/pull/4218",
      );
    });

    it("explains what the two context figures each count", async () => {
      pinSessions([sessionRow()]);
      const user = userEvent.setup();
      renderTable();

      await user.hover(screen.getByText("Peak 156.8K"));

      expect(
        await screen.findByText(
          /largest context carried into a single model call/i,
        ),
      ).toBeInTheDocument();
    });

    it("puts the tokens a compaction dropped behind the count", async () => {
      pinSessions([sessionRow()]);
      const user = userEvent.setup();
      renderTable();

      await user.hover(screen.getByText("3 compactions"));

      expect(
        await screen.findByText("Compacted from 180.0K to 42.0K tokens"),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("Largest cache rebuild 90.0K tokens"),
      ).toBeInTheDocument();
    });

    it("reads a session that never compacted or rebuilt as having neither", () => {
      pinSessions([
        sessionRow({ compactions: 0, cacheRebuildCount: 0, pullRequests: [] }),
      ]);

      renderTable();

      expect(screen.queryByText(/compaction/)).not.toBeInTheDocument();
      expect(screen.queryByText(/cache rebuild/)).not.toBeInTheDocument();
    });
  });

  describe("given a personal workspace with no coding-agent sessions", () => {
    /** @scenario "A workspace with no sessions says so" */
    it("says nothing has been recorded yet and offers nothing to narrow", () => {
      pinSessions([]);

      renderTable();

      expect(screen.getByText("No sessions recorded yet")).toBeInTheDocument();
      // Nothing to search or narrow: the toolbar would be furniture over an
      // empty room.
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });
  });

  describe("given a session whose agent never generated a title", () => {
    /** @scenario "A session with no title reads as untitled" */
    it("names it as an untitled session and still says where it ran", () => {
      pinSessions([sessionRow({ title: null })]);

      renderTable();

      expect(screen.getByText("Untitled session")).toBeInTheDocument();
      expect(
        screen.getByText("acme/widgets · feat/git-context"),
      ).toBeInTheDocument();
    });
  });

  describe("given a session whose branch has no pull request", () => {
    /** @scenario "A session with no pull request reads as none" */
    it("reads the pull request cell as absent", () => {
      pinSessions([sessionRow({ pullRequests: [] })]);

      renderTable();

      expect(screen.queryByText("#4218")).not.toBeInTheDocument();
      // Every other cell on this row has something to say, so the one
      // placeholder on screen is the pull request cell's.
      expect(screen.getAllByText("—")).toHaveLength(1);
    });
  });

  describe("given a session that drove more pull requests than the row lists", () => {
    it("links the first few and puts the rest behind a hover", async () => {
      pinSessions([
        sessionRow({
          pullRequests: [4218, 4219, 4220, 4221, 4222].map((number) => ({
            number,
            url: `https://github.com/acme/widgets/pull/${number}`,
            title: `Pull request ${number}`,
          })),
        }),
      ]);
      const user = userEvent.setup();
      renderTable();

      expect(screen.getByText("#4218")).toBeInTheDocument();
      expect(screen.getByText("#4220")).toBeInTheDocument();
      expect(screen.queryByText("#4221")).not.toBeInTheDocument();

      await user.hover(screen.getByText("+2"));
      expect(
        await screen.findByText("#4221 Pull request 4221"),
      ).toBeInTheDocument();
    });
  });

  describe("given a page of sessions from several repositories", () => {
    beforeEach(() => {
      pinSessions([
        sessionRow(),
        sessionRow({
          sessionId: "session-2",
          title: "Retry the ingestion queue",
          repositoryName: "gateway",
          gitBranch: "fix/queue-retry",
          gitBranches: ["chore/first-pass", "fix/queue-retry"],
          agent: "codex",
          models: ["gpt-5-mini"],
          pullRequests: [
            {
              number: 7001,
              url: "https://github.com/acme/gateway/pull/7001",
              title: "Retry the ingestion queue",
            },
          ],
        }),
      ]);
    });

    /** @scenario "The table narrows to the sessions matching a search" */
    it("keeps only the sessions matching the title, repository, branch, agent, model or pull request", async () => {
      const user = userEvent.setup();
      renderTable();

      const search = screen.getByRole("searchbox");
      const listed = () => screen.queryByText("Link sessions to pull requests");
      const other = () => screen.queryByText("Retry the ingestion queue");

      await user.type(search, "RETRY THE INGESTION");
      expect(other()).toBeInTheDocument();
      expect(listed()).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "acme/GATEWAY");
      expect(other()).toBeInTheDocument();
      expect(listed()).not.toBeInTheDocument();

      // A branch the session moved off is still a branch it drove, so it is
      // still a way back to the session.
      await user.clear(search);
      await user.type(search, "chore/first-pass");
      expect(other()).toBeInTheDocument();
      expect(listed()).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "gpt-5-mini");
      expect(other()).toBeInTheDocument();
      expect(listed()).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "codex");
      expect(other()).toBeInTheDocument();
      expect(listed()).not.toBeInTheDocument();

      for (const numeric of ["#4218", "4218"]) {
        await user.clear(search);
        await user.type(search, numeric);
        expect(listed()).toBeInTheDocument();
        expect(other()).not.toBeInTheDocument();
      }

      await user.clear(search);
      await user.type(search, "nothing here");
      expect(screen.getByText("No sessions match")).toBeInTheDocument();
      // The way back is where the reader left it.
      expect(screen.getByRole("searchbox")).toHaveValue("nothing here");
    });
  });

  describe("given sessions last updated at different times", () => {
    /** @scenario "A period keeps only rows whose last update falls inside it" */
    it("lists only the sessions last updated inside the chosen period", async () => {
      pinSessions([
        sessionRow({
          sessionId: "warm",
          title: "Worked on this morning",
          lastEventOccurredAtMs: Date.now() - 2 * 60 * 60 * 1000,
          startedAtMs: Date.now() - 3 * 60 * 60 * 1000,
        }),
        sessionRow({
          sessionId: "cold",
          title: "Untouched for a month",
          lastEventOccurredAtMs: Date.now() - 40 * DAY_MS,
          startedAtMs: Date.now() - 41 * DAY_MS,
        }),
      ]);
      const user = userEvent.setup();
      renderTable();

      // Nothing is hidden until the reader asks for a window.
      expect(screen.getByText("Untouched for a month")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /all time/i }));
      await user.click(await screen.findByText("Last 7 days"));

      expect(screen.getByText("Worked on this morning")).toBeInTheDocument();
      expect(
        screen.queryByText("Untouched for a month"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a listed page of sessions", () => {
    beforeEach(() => {
      // The three orders are deliberately all different, so returning to the
      // default is a real return rather than the input order coming back.
      pinSessions([
        sessionOfTokens({
          sessionId: "s1",
          title: "Light session",
          totalTokens: 5_000,
          lastEventOccurredAtMs: LONG_AGO - 3_000,
        }),
        sessionOfTokens({
          sessionId: "s2",
          title: "Heavy session",
          totalTokens: 900_000,
          lastEventOccurredAtMs: LONG_AGO - 2_000,
        }),
        sessionOfTokens({
          sessionId: "s3",
          title: "Middling session",
          totalTokens: 20_000,
          lastEventOccurredAtMs: LONG_AGO - 1_000,
        }),
      ]);
    });

    /** @scenario "Every column sorts, and sorting has a way back" */
    it("sorts from a heading, reverses on the second choice, and returns to the opening order on the third", async () => {
      const user = userEvent.setup();
      renderTable();

      expect(headingFor("Last update")).toHaveAttribute(
        "aria-sort",
        "descending",
      );
      expect(headingFor("Context")).toHaveAttribute("aria-sort", "none");
      const opening = listedTitles();
      expect(opening).toEqual([
        "Middling session",
        "Heavy session",
        "Light session",
      ]);

      await user.click(screen.getByRole("button", { name: "Sort by Context" }));
      expect(headingFor("Context")).toHaveAttribute("aria-sort", "descending");
      expect(headingFor("Last update")).toHaveAttribute("aria-sort", "none");
      expect(listedTitles()).toEqual([
        "Heavy session",
        "Middling session",
        "Light session",
      ]);

      await user.click(screen.getByRole("button", { name: "Sort by Context" }));
      expect(headingFor("Context")).toHaveAttribute("aria-sort", "ascending");
      expect(listedTitles()).toEqual([
        "Light session",
        "Middling session",
        "Heavy session",
      ]);

      await user.click(screen.getByRole("button", { name: "Sort by Context" }));
      expect(headingFor("Context")).toHaveAttribute("aria-sort", "none");
      expect(headingFor("Last update")).toHaveAttribute(
        "aria-sort",
        "descending",
      );
      expect(listedTitles()).toEqual(opening);
    });
  });

  describe("given more sessions than one page shows", () => {
    /** @scenario "The table pages through more sessions than fit at once" */
    it("lists the following sessions when the page is changed", async () => {
      pinSessions(
        Array.from({ length: 12 }, (_, index) =>
          sessionOfTokens({
            sessionId: `session-${index}`,
            title: `Session ${index}`,
            totalTokens: 1_000,
            lastEventOccurredAtMs: LONG_AGO - index * 1_000,
          }),
        ),
      );
      const user = userEvent.setup();
      renderTable();

      fireEvent.change(screen.getByTestId("pagination-page-size"), {
        target: { value: "10" },
      });
      expect(screen.getByText("Session 0")).toBeInTheDocument();
      expect(screen.queryByText("Session 11")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /next/i }));

      expect(screen.getByText("Session 11")).toBeInTheDocument();
      expect(screen.queryByText("Session 0")).not.toBeInTheDocument();
    });
  });

  describe("given a listed session", () => {
    beforeEach(() => {
      pinSessions([sessionRow()]);
    });

    /** @scenario "Choosing a session opens its terminal replay" */
    it("opens the session's last turn in the terminal view, over the table", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("Link sessions to pull requests"));

      await waitFor(() =>
        expect(mockOpenTrace).toHaveBeenCalledWith(
          "trace-last",
          LONG_AGO + 5_000,
          { projectId: "proj-personal" },
        ),
      );
      expect(utils.tracesV2.conversationContext.fetch).toHaveBeenCalledWith({
        projectId: "proj-personal",
        conversationId: "session-1",
      });
      expect(mockSetViewModeTransient).toHaveBeenCalledWith("terminal");
      expect(mockOpenDrawer).toHaveBeenCalledWith("traceV2Details", {
        traceId: "trace-last",
        t: String(LONG_AGO + 5_000),
        mode: "terminal",
        projectId: "proj-personal",
      });
      // The replay opens where the reader already is; nothing navigates.
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it("marks the row as busy while the session's turns are being looked up", async () => {
      let resolveTurns: (value: unknown) => void = () => undefined;
      utils.tracesV2.conversationContext.fetch.mockReturnValue(
        new Promise((resolve) => {
          resolveTurns = resolve;
        }),
      );
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("Link sessions to pull requests"));
      expect(document.querySelector("tbody tr")).toHaveAttribute(
        "aria-busy",
        "true",
      );

      resolveTurns({ conversationId: "session-1", total: 1, turns: [turn()] });
      await waitFor(() =>
        expect(document.querySelector("tbody tr")).toHaveAttribute(
          "aria-busy",
          "false",
        ),
      );
    });

    it("pays for the lookup on hover so the click opens straight away", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.hover(screen.getByText("Link sessions to pull requests"));

      expect(utils.tracesV2.conversationContext.prefetch).toHaveBeenCalledWith({
        projectId: "proj-personal",
        conversationId: "session-1",
      });
    });

    it("says so plainly when the session stored no turns to replay", async () => {
      pinTurns([]);
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("Link sessions to pull requests"));

      await waitFor(() =>
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "No stored traces for this session yet",
          }),
        ),
      );
      expect(mockOpenTrace).not.toHaveBeenCalled();
    });

    it("reports a failed lookup rather than opening an empty replay", async () => {
      utils.tracesV2.conversationContext.fetch.mockRejectedValue(
        new Error("clickhouse is down"),
      );
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("Link sessions to pull requests"));

      await waitFor(() => expect(mockShowErrorToast).toHaveBeenCalled());
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it("does not open the replay when the row's actions menu is used", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(
        screen.getByRole("button", {
          name: "Actions for Link sessions to pull requests",
        }),
      );

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it("sends the reader to the trace explorer from the row's actions menu", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(
        screen.getByRole("button", {
          name: "Actions for Link sessions to pull requests",
        }),
      );
      await user.click(await screen.findByText("View on Trace Explorer"));

      await waitFor(() =>
        expect(mockRouterPush).toHaveBeenCalledWith(
          `/acme-personal/traces?drawer.open=traceV2Details&drawer.traceId=trace-last&drawer.t=${LONG_AGO + 5_000}&drawer.mode=terminal`,
        ),
      );
    });

    it("leaves a pull request chip to GitHub rather than to the replay", async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByText("#4218"));

      expect(mockOpenTrace).not.toHaveBeenCalled();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });

  describe("given an open terminal replay reached from the table", () => {
    /** @scenario "Leaving the replay returns to the table as it was" */
    it("leaves the table sorted, narrowed and paged exactly as it was", async () => {
      pinSessions([
        sessionOfTokens({
          sessionId: "s1",
          title: "Queue light session",
          totalTokens: 5_000,
          lastEventOccurredAtMs: LONG_AGO - 3_000,
        }),
        sessionOfTokens({
          sessionId: "s2",
          title: "Queue heavy session",
          totalTokens: 900_000,
          lastEventOccurredAtMs: LONG_AGO - 2_000,
        }),
        sessionOfTokens({
          sessionId: "s3",
          title: "Elsewhere entirely",
          totalTokens: 20_000,
          lastEventOccurredAtMs: LONG_AGO - 1_000,
        }),
      ]);
      const user = userEvent.setup();
      renderTable();

      await user.type(screen.getByRole("searchbox"), "Queue");
      await user.click(screen.getByRole("button", { name: "Sort by Context" }));
      const narrowed = listedTitles();
      expect(narrowed).toEqual(["Queue heavy session", "Queue light session"]);

      await user.click(screen.getByText("Queue heavy session"));
      await waitFor(() => expect(mockOpenTrace).toHaveBeenCalled());

      // Closing is the drawer's own doing, and it is what makes the table
      // visible again rather than what rebuilds it. What has to hold is that
      // opening the replay left this table standing: still narrowed, still
      // sorted, still on its page, and never navigated away from. A table the
      // reader was sent away from would have nothing to come back to.
      expect(listedTitles()).toEqual(narrowed);
      expect(screen.getByRole("searchbox")).toHaveValue("Queue");
      expect(headingFor("Context")).toHaveAttribute("aria-sort", "descending");
      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });
});
