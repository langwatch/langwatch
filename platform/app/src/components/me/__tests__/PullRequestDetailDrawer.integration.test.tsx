/**
 * @vitest-environment jsdom
 *
 * The pull request detail drawer: what it puts in front of a reader, and the
 * one thing it must never carry.
 *
 * The tRPC surface is a proxy that answers every query empty unless a test
 * pins it, so the drawer's single read is the only wiring under test.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const {
  queryImpls,
  utils,
  mockCloseDrawer,
  mockOpenDrawer,
  mockOpenTrace,
  mockSetViewModeTransient,
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
  mockCloseDrawer: vi.fn(),
  mockOpenDrawer: vi.fn(),
  mockOpenTrace: vi.fn(),
  mockSetViewModeTransient: vi.fn(),
  mockRouterPush: vi.fn(),
  mockToasterCreate: vi.fn(),
  mockShowErrorToast: vi.fn(),
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
    const hooks = new Map<string, unknown>([
      ["useQuery", useQuery],
      ["useInfiniteQuery", useQuery],
    ]);
    // The imperative side of the same client, which the replay uses to look a
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

import { PullRequestDetailDrawer } from "../PullRequestDetailDrawer";

function pinDetail(data: unknown) {
  queryImpls["codingAgents.pullRequestDetail"] = () => ({
    data,
    isLoading: false,
    isError: false,
    isFetched: true,
  });
}

function detailPayload(over: Record<string, unknown> = {}) {
  return {
    pullRequest: {
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
    },
    totals: {
      sessionsCount: 3,
      inputTokens: 1_000,
      outputTokens: 2_000,
      cacheReadTokens: 3_000,
      cacheCreationTokens: 4_000,
      totalTokens: 10_000,
      costUsd: 12.5,
      billedCostUsd: 2.5,
      nonBilledCostUsd: 10,
    },
    contributors: [
      {
        projectId: "project-1",
        projectSlug: "riley-personal",
        contributorLabel: "Riley Chase",
        contributorIsProject: false,
        agent: "claude_code",
        models: ["claude-fable-5"],
        sessionsCount: 2,
        inputTokens: 800,
        outputTokens: 1_600,
        cacheReadTokens: 2_400,
        cacheCreationTokens: 3_200,
        totalTokens: 8_000,
        costUsd: 10,
        billedCostUsd: 0,
        nonBilledCostUsd: 10,
      },
    ],
    modelBreakdown: [
      {
        model: "claude-fable-5",
        inputTokens: 800,
        outputTokens: 1_600,
        cacheReadTokens: 2_400,
        cacheCreationTokens: 3_200,
        totalTokens: 8_000,
        costUsd: 10,
        tokensKnown: true,
      },
    ],
    sessions: [sessionFact()],
    ...over,
  };
}

/** One session line of the detail, filled in around whatever a case pins. */
function sessionFact(over: Record<string, unknown> = {}) {
  return {
    sessionId: "session-a",
    startedAtMs: Date.parse("2026-07-01T10:30:00Z"),
    projectId: "project-1",
    projectSlug: "riley-personal",
    contributorLabel: "Riley Chase",
    contributorIsProject: false,
    agent: "claude_code",
    totalTokens: 4_000,
    costUsd: 5,
    title: null as string | null,
    ...over,
  };
}

/**
 * Every property that could set one cost cell apart from another, read off the
 * element as the browser resolved it. Compared whole rather than property by
 * property, so a color branch reintroduced under any name is caught rather
 * than only the one property a test happened to name.
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

/** One contributor line, filled in around whatever a case pins. */
function contributorRow(over: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    projectSlug: "riley-personal",
    contributorLabel: "Riley Chase",
    contributorIsProject: false,
    agent: "claude_code",
    models: ["claude-fable-5"],
    sessionsCount: 1,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 1,
    cacheCreationTokens: 1,
    totalTokens: 4,
    costUsd: 1,
    billedCostUsd: 1,
    nonBilledCostUsd: 0,
    ...over,
  };
}

function renderDrawer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PullRequestDetailDrawer
        projectId="proj-personal"
        repositoryHost="github.com"
        repositoryFullName="acme/widgets"
        prNumber={4218}
      />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(queryImpls)) delete queryImpls[key];
  utils.tracesV2.conversationContext.fetch.mockReset();
  utils.tracesV2.conversationContext.prefetch.mockReset();
  mockOpenDrawer.mockClear();
  mockOpenTrace.mockClear();
  mockSetViewModeTransient.mockClear();
  mockRouterPush.mockClear();
  mockToasterCreate.mockClear();
  mockShowErrorToast.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("the pull request detail drawer", () => {
  describe("given a pull request with sessions from several people", () => {
    beforeEach(() => {
      pinDetail(detailPayload());
    });

    /** @scenario "The detail carries its contributors, models and sessions" */
    /** @scenario "The drawer names who worked on the pull request" */
    it("shows the header, the totals, the contributors, the models and the sessions", () => {
      renderDrawer();

      expect(screen.getByText("Link sessions to pull requests")).toBeInTheDocument();
      expect(screen.getByText("#4218")).toBeInTheDocument();
      expect(screen.getByText("acme/widgets")).toBeInTheDocument();
      const githubLink = screen.getByText("Open on GitHub").closest("a");
      expect(githubLink).toHaveAttribute(
        "href",
        "https://github.com/acme/widgets/pull/4218",
      );
      expect(githubLink).toHaveAttribute("target", "_blank");
      expect(githubLink?.getAttribute("rel")).toContain("noopener");

      expect(screen.getByRole("heading", { name: "Sessions" })).toBeInTheDocument();
      expect(screen.getByText("10.0K")).toBeInTheDocument();
      expect(screen.getByText("$12.50")).toBeInTheDocument();

      expect(screen.getByText("Contributors")).toBeInTheDocument();
      expect(screen.getAllByText("Riley Chase").length).toBeGreaterThan(0);

      expect(screen.getByText("Models")).toBeInTheDocument();
      expect(screen.getByText("claude-fable-5")).toBeInTheDocument();
      expect(screen.getByText("8.0K tokens")).toBeInTheDocument();
    });

    it("lists a session by its facts", () => {
      renderDrawer();

      expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
      expect(
        document.body.querySelector('img[src="/images/external-icons/claude-code.svg"]'),
      ).not.toBeNull();
      expect(screen.getByText("$5.00")).toBeInTheDocument();
      // The session id is a handle onto the transcript, and the drawer renders
      // only what the read carries, which is not that.
      expect(document.body.textContent).not.toContain("session-a");
    });
  });

  describe("given a pull request whose sessions include one with a title and one without", () => {
    /** @scenario "The drawer names each session by its title, or says it has none" */
    it("names the titled session and calls the other untitled", () => {
      pinDetail(
        detailPayload({
          sessions: [
            sessionFact({ title: "Add the sessions screen" }),
            sessionFact({ sessionId: "session-b", title: null }),
          ],
        }),
      );

      renderDrawer();

      expect(screen.getByText("Add the sessions screen")).toBeInTheDocument();
      // A session with no title, and one whose title this reader may not see,
      // read the same way: the row is still worth listing for what it cost.
      expect(screen.getByText("Untitled session")).toBeInTheDocument();
    });
  });

  describe("given a pull request worked on by two different assistants", () => {
    /** @scenario "The detail names each agent like its product, with its mark" */
    it("names each assistant the way its own product is named, with its mark", () => {
      pinDetail(
        detailPayload({
          contributors: [
            contributorRow({ agent: "claude_code" }),
            contributorRow({ agent: "codex" }),
            contributorRow({ agent: "mystery_agent" }),
          ],
        }),
      );

      // The drawer is portalled, so the whole document is the container here.
      renderDrawer();

      expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
      expect(
        document.body.querySelector('img[src="/images/external-icons/claude-code.svg"]'),
      ).not.toBeNull();
      expect(screen.getByText("Codex")).toBeInTheDocument();
      expect(
        document.body.querySelector('img[src="/images/external-icons/codex.svg"]'),
      ).not.toBeNull();

      // An assistant this build cannot name keeps the spelling that arrived,
      // rather than borrowing a mark that would name the wrong product.
      const unknown = screen.getByText("mystery_agent").closest("td");
      expect(unknown).not.toBeNull();
      expect(unknown?.querySelector("img")).toBeNull();
    });
  });

  describe("given an open pull request detail", () => {
    /** @scenario "The detail's GitHub button opens the pull request in a new tab" */
    it("sends its GitHub button to the pull request in a new tab", () => {
      pinDetail(detailPayload());

      renderDrawer();

      // A new tab is what leaves the detail where it was, so the target is the
      // behavior under test rather than a detail of the markup.
      const link = screen.getByText("Open on GitHub").closest("a");
      expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/pull/4218");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link?.getAttribute("rel")).toContain("noopener");
      expect(screen.getByText("Link sessions to pull requests")).toBeInTheDocument();
    });
  });

  describe("given a pull request that was merged", () => {
    /** @scenario "The detail tells the same status story as the list" */
    it("draws the merged badge the table draws, from the same payload", () => {
      const base = detailPayload();
      pinDetail(
        detailPayload({
          pullRequest: {
            ...base.pullRequest,
            state: "closed",
            prClosedAtMs: Date.parse("2026-07-02T09:00:00Z"),
            prMergedAtMs: Date.parse("2026-07-02T09:00:00Z"),
          },
        }),
      );

      renderDrawer();

      // Merged wins over the close GitHub records alongside it, and the badge
      // says where the answer came from so it cannot pass for a live one.
      const badge = screen.getByText("Merged");
      expect(badge).toHaveAttribute("data-status", "merged");
      expect(badge).toHaveAttribute("data-status-source", "payload");
    });
  });

  describe("given a pull request whose cost is partly not billed", () => {
    /** @scenario "A bundled token cost reads like every other token cost" */
    it("draws a bundled value exactly like a billed one and keeps the split to the tooltip", async () => {
      pinDetail(
        detailPayload({
          contributors: [
            contributorRow({
              agent: "claude_code",
              costUsd: 10,
              billedCostUsd: 0,
              nonBilledCostUsd: 10,
            }),
            contributorRow({
              agent: "codex",
              costUsd: 10,
              billedCostUsd: 10,
              nonBilledCostUsd: 0,
            }),
          ],
        }),
      );
      const user = userEvent.setup();

      renderDrawer();

      const [bundled, billed] = screen.getAllByText("$10.00");
      // Whatever the styling of a number in this column is, the two are the
      // same number to a reader: any branch that sets one apart from the
      // other fails here, whichever property it reaches for.
      expect(renderedStyleOf(bundled!)).toEqual(renderedStyleOf(billed!));
      expect(document.body.textContent).not.toContain("Non-billed");

      // The split is real and still reachable, one hover away.
      await user.hover(screen.getByText("$12.50"));
      expect(await screen.findByText("Non-billed")).toBeInTheDocument();
      expect(await screen.findByText("Billed")).toBeInTheDocument();
    });
  });

  describe("given a pull request nothing has run on yet", () => {
    it("says so in each section rather than showing empty tables", () => {
      pinDetail(detailPayload({ contributors: [], modelBreakdown: [], sessions: [] }));

      renderDrawer();

      expect(
        screen.getAllByText("No sessions ran on this pull request yet"),
      ).toHaveLength(2);
      expect(
        screen.getByText("No model data for this pull request yet"),
      ).toBeInTheDocument();
    });
  });

  describe("given a pull request whose sessions logged no per-call model data", () => {
    /** @scenario "The detail names the models even without per-call data" */
    it("names the models rather than claiming there is no model data", () => {
      pinDetail(
        detailPayload({
          modelBreakdown: [
            { model: "claude-opus-5", tokensKnown: false },
            { model: "gpt-5", tokensKnown: false },
          ],
        }),
      );

      renderDrawer();

      expect(screen.getByText("claude-opus-5")).toBeInTheDocument();
      expect(screen.getByText("gpt-5")).toBeInTheDocument();
      expect(
        screen.queryByText("No model data for this pull request yet"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given the read is still in flight", () => {
    it("shows placeholders rather than an empty drawer", () => {
      queryImpls["codingAgents.pullRequestDetail"] = () => ({
        data: undefined,
        isLoading: true,
        isError: false,
        isFetched: false,
      });

      renderDrawer();

      expect(screen.getByText("#4218")).toBeInTheDocument();
      expect(screen.queryByText("Contributors")).not.toBeInTheDocument();
    });
  });

  describe("given the drawer was opened from its own address", () => {
    /** @scenario "A detail opened from its own address still finds its pull request" */
    it("reads the pull request by its number even though the address carries text", () => {
      const seen: unknown[] = [];
      queryImpls["codingAgents.pullRequestDetail"] = (input) => {
        seen.push(input);
        return {
          data: detailPayload(),
          isLoading: false,
          isError: false,
          isFetched: true,
        };
      };

      render(
        <ChakraProvider value={defaultSystem}>
          <PullRequestDetailDrawer
            projectId="proj-personal"
            repositoryHost="github.com"
            repositoryFullName="acme/widgets"
            prNumber={"4218" as unknown as number}
          />
        </ChakraProvider>,
      );

      expect(seen[0]).toMatchObject({ prNumber: 4218 });
      expect(screen.getByText("#4218")).toBeInTheDocument();
      expect(
        screen.queryByText("Couldn't load this pull request"),
      ).not.toBeInTheDocument();
    });
  });

  describe("given a contributor named by a long project name", () => {
    /** @scenario "A contributor named by a long name keeps the whole of it" */
    it("keeps the whole name reachable beside the cut-down cell", () => {
      const name = "Platform Reliability and Developer Experience".repeat(3);
      pinDetail(
        detailPayload({
          contributors: [
            contributorRow({
              projectId: "project-2",
              projectSlug: "platform-reliability",
              contributorLabel: name,
              contributorIsProject: true,
            }),
          ],
        }),
      );

      renderDrawer();

      // The cell is bounded, so the name only stays readable because the whole
      // of it is carried alongside the text that had to be cut.
      const cell = screen.getAllByText(name)[0]?.closest("td");
      expect(cell).toHaveAttribute("title", name);
    });
  });

  describe("given work that ran in a shared project", () => {
    /** @scenario "A shared project is named by the project the work ran in" */
    it("names the project and opens its traces, and never an agent-reported id", () => {
      pinDetail(
        detailPayload({
          contributors: [
            contributorRow({
              projectId: "project-2",
              projectSlug: "gateway",
              contributorLabel: "Gateway",
              contributorIsProject: true,
            }),
          ],
          sessions: [
            {
              sessionId: "session-b",
              startedAtMs: Date.parse("2026-07-01T10:30:00Z"),
              projectId: "project-2",
              projectSlug: "gateway",
              contributorLabel: "Gateway",
              contributorIsProject: true,
              agent: "claude_code",
              totalTokens: 4_000,
              costUsd: 5,
            },
          ],
        }),
      );

      renderDrawer();

      for (const link of screen.getAllByText("Gateway")) {
        expect(link.closest("a")).toHaveAttribute("href", "/gateway/traces");
      }
      // The columns a contributor used to share with a separate project cell
      // are gone: the contributor IS the project when the work is shared.
      expect(
        screen.queryByRole("columnheader", { name: "Project" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("given work that ran in someone's own workspace", () => {
    /** @scenario "A personal workspace is named by the person whose work it is" */
    it("names the person and links nothing", () => {
      pinDetail(detailPayload());

      renderDrawer();

      for (const name of screen.getAllByText("Riley Chase")) {
        expect(name.closest("a")).toBeNull();
      }
    });
  });

  describe("given the read failed", () => {
    it("says the pull request could not be loaded", () => {
      queryImpls["codingAgents.pullRequestDetail"] = () => ({
        data: undefined,
        isLoading: false,
        isError: true,
        isFetched: true,
      });

      renderDrawer();

      expect(screen.getByText("Couldn't load this pull request")).toBeInTheDocument();
    });
  });

  describe("given a pull request detail listing the sessions that ran on it", () => {
    beforeEach(() => {
      pinDetail(
        detailPayload({
          sessions: [
            sessionFact({
              sessionId: "session-a",
              title: "Teach the fold about branches",
            }),
          ],
        }),
      );
    });

    describe("when the reader chooses one of those session rows", () => {
      /** @scenario "Choosing a session from the pull request drawer opens its replay" */
      it("opens that session's terminal replay in the workspace it was read in", async () => {
        utils.tracesV2.conversationContext.fetch.mockResolvedValue({
          turns: [
            { traceId: "trace-early", timestamp: 1_000 },
            { traceId: "trace-last", timestamp: 2_000 },
          ],
        });
        const user = userEvent.setup();
        renderDrawer();

        await user.click(screen.getByText("Teach the fold about branches"));

        // The turns of that session, and the last of them is what a replay
        // opens on.
        await waitFor(() =>
          expect(utils.tracesV2.conversationContext.fetch).toHaveBeenCalledWith({
            projectId: "proj-personal",
            conversationId: "session-a",
          }),
        );
        // The project travels with the trace. These rows are read from the
        // caller's own workspace, so a drawer left to resolve the project
        // itself would query whichever one the chrome was sitting in and
        // report the trace missing.
        expect(mockOpenTrace).toHaveBeenCalledWith("trace-last", 2_000, {
          projectId: "proj-personal",
        });
        expect(mockSetViewModeTransient).toHaveBeenCalledWith("terminal");
        expect(mockOpenDrawer).toHaveBeenCalledWith("traceV2Details", {
          traceId: "trace-last",
          t: "2000",
          mode: "terminal",
          projectId: "proj-personal",
        });
      });

      /** @scenario "Leaving the replay returns to the pull request it was opened from" */
      it("leaves the pull request drawer standing underneath rather than closing it", async () => {
        utils.tracesV2.conversationContext.fetch.mockResolvedValue({
          turns: [{ traceId: "trace-last", timestamp: 2_000 }],
        });
        const user = userEvent.setup();
        renderDrawer();

        await user.click(screen.getByText("Teach the fold about branches"));
        await waitFor(() => expect(mockOpenDrawer).toHaveBeenCalled());

        // The replay is pushed onto the drawer stack rather than replacing
        // this drawer, which is what lets closing it come back here: the
        // detail is never closed, and the reader is never sent to a page.
        expect(mockCloseDrawer).not.toHaveBeenCalled();
        expect(mockRouterPush).not.toHaveBeenCalled();
        expect(screen.getByText("Link sessions to pull requests")).toBeInTheDocument();
      });

      it("marks the row busy and shows nothing else opening while the turn resolves", async () => {
        let releaseTurns: (value: unknown) => void = () => undefined;
        utils.tracesV2.conversationContext.fetch.mockReturnValue(
          new Promise((resolve) => {
            releaseTurns = resolve;
          }),
        );
        const user = userEvent.setup();
        renderDrawer();

        await user.click(screen.getByText("Teach the fold about branches"));

        const row = screen.getByText("Teach the fold about branches").closest("tr");
        expect(row).toHaveAttribute("aria-busy", "true");

        releaseTurns({ turns: [{ traceId: "trace-last", timestamp: 2_000 }] });
        await waitFor(() => expect(mockOpenDrawer).toHaveBeenCalled());
        expect(row).toHaveAttribute("aria-busy", "false");
      });
    });

    describe("when the reader has no pointer", () => {
      // A click handler on the row alone cannot be reached from a keyboard: a
      // table row takes no focus and has no activation behaviour. The replay
      // is therefore carried by a real button with its own accessible name,
      // which is what makes it focusable and what gives Enter and Space their
      // meaning for free. Asserting the role is what pins that: a row that
      // went back to being only clickable has no button to find.
      it("exposes the replay as a focusable control, not just a clickable row", async () => {
        utils.tracesV2.conversationContext.fetch.mockResolvedValue({
          turns: [{ traceId: "trace-last", timestamp: 2_000 }],
        });
        const user = userEvent.setup();
        renderDrawer();

        const control = screen.getByRole("button", {
          name: "Open the terminal replay of Teach the fold about branches",
        });
        expect(control.tagName).toBe("BUTTON");
        control.focus();
        expect(control).toHaveFocus();

        await user.click(control);

        await waitFor(() => expect(mockOpenDrawer).toHaveBeenCalledTimes(1));
      });
    });

    describe("when the reader double-clicks the same session", () => {
      it("looks it up once rather than opening two replays", async () => {
        let releaseTurns: (value: unknown) => void = () => undefined;
        utils.tracesV2.conversationContext.fetch.mockReturnValue(
          new Promise((resolve) => {
            releaseTurns = resolve;
          }),
        );
        const user = userEvent.setup();
        renderDrawer();

        const title = screen.getByText("Teach the fold about branches");
        await user.click(title);
        await user.click(title);

        // The second click lands while the first lookup is still in flight,
        // and is the same request, so it is dropped rather than answered.
        expect(utils.tracesV2.conversationContext.fetch).toHaveBeenCalledTimes(1);

        releaseTurns({ turns: [{ traceId: "trace-last", timestamp: 2_000 }] });
        await waitFor(() => expect(mockOpenDrawer).toHaveBeenCalledTimes(1));
      });
    });

    describe("when the reader hovers a session row", () => {
      it("pays for the lookup the click needs ahead of the click", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.hover(screen.getByText("Teach the fold about branches"));

        expect(utils.tracesV2.conversationContext.prefetch).toHaveBeenCalledWith({
          projectId: "proj-personal",
          conversationId: "session-a",
        });
      });
    });
  });

  describe("given a session on the pull request detail whose turns were never stored", () => {
    beforeEach(() => {
      pinDetail(
        detailPayload({
          sessions: [sessionFact({ title: "Ran but stored nothing" })],
        }),
      );
    });

    describe("when the reader chooses it", () => {
      /** @scenario "A session with nothing stored says so instead of opening an empty replay" */
      it("says the session stored none of its turns and opens no replay", async () => {
        utils.tracesV2.conversationContext.fetch.mockResolvedValue({
          turns: [],
        });
        const user = userEvent.setup();
        renderDrawer();

        await user.click(screen.getByText("Ran but stored nothing"));

        await waitFor(() =>
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "No stored traces for this session yet",
              type: "info",
            }),
          ),
        );
        expect(mockOpenDrawer).not.toHaveBeenCalled();
        expect(mockOpenTrace).not.toHaveBeenCalled();
      });

      it("reports a failed lookup through the shared error toast", async () => {
        utils.tracesV2.conversationContext.fetch.mockRejectedValue(
          new Error("clickhouse said no"),
        );
        const user = userEvent.setup();
        renderDrawer();

        await user.click(screen.getByText("Ran but stored nothing"));

        await waitFor(() =>
          expect(mockShowErrorToast).toHaveBeenCalledWith(
            expect.objectContaining({
              fallbackTitle: "Couldn't open the terminal replay",
            }),
          ),
        );
        expect(mockOpenDrawer).not.toHaveBeenCalled();
      });
    });
  });
});
