/**
 * @vitest-environment jsdom
 * "Daily insights" in a board's header over the real tRPC hooks: the three states,
 * what each write sends and what the control says about the last run.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import {
  INSIGHT_DAILY_RUN_EXPIRY_MS,
  INSIGHT_RUN_SKIP_REASONS,
  type InsightDailyRunSetting,
  type InsightEntry,
} from "@langwatch/insight-contract";
import { currentTimeZone, format, nowInstant } from "@langwatch/time";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OFF_REASON_WORDS, SKIP_REASON_WORDS } from "../../../model/daily-run.ts";
import {
  insightEntry,
  renderWithInsightHost,
  StubInsightHost,
  type StubInsightHostOptions,
} from "../../../testing.tsx";
import { BoardDailyInsights } from "../board-daily-insights.tsx";

const AMSTERDAM = "Europe/Amsterdam";
const NOW = nowInstant().epochMilliseconds;
const READ = "insights.getBoardDailyRun";
const CONFIGURE = "insights.configureBoardDailyRun";
const TURN_OFF = "insights.turnOffBoardDailyRun";
const RUN_NOW = "insights.runBoardDailyRunNow";

const NOTHING_YET = { settings: null, lastRun: null, offReason: null, runInFlight: null };
const UNDECIDED: InsightDailyRunSetting = { state: "undecided", ...NOTHING_YET };
const OFF_WITHOUT_CHOICES: InsightDailyRunSetting = { state: "off", ...NOTHING_YET };
const ON: InsightDailyRunSetting = {
  state: "on",
  settings: { hour: 9, timezone: AMSTERDAM, maxInsights: 3 },
  lastRun: null,
  offReason: null,
  runInFlight: null,
};
const RUNNING: InsightDailyRunSetting = {
  ...ON,
  runInFlight: { runId: "request-1", conversationId: "conversation-7", startedAt: NOW },
};
/** What the server answers Run now with: the request's id, and when its clock recorded it. */
function runNowAnswer({
  requestId = "request-1",
  requestedAt = nowInstant().epochMilliseconds,
} = {}) {
  return Promise.resolve({ requestId, requestedAt });
}

/** A read that fails for good: this status is not retried, so the answer lands at once. */
const READ_REFUSED = () =>
  Promise.reject<InsightDailyRunSetting>(new UiProcedureRefusal("forbidden", 403));

/** What a read the test changes as it goes can answer. */
type ReadAnswer = () => InsightDailyRunSetting | Promise<InsightDailyRunSetting>;

/** The shape of a board, as `openBoard` takes it. */
type BoardShape = Parameters<typeof openBoard>[0];
type RanOverrides = Partial<LastRun>;
type LangyQuery = Record<string, string>;
type Notice = { title: string };

/** A member who may also ask Langy, which a run is. */
const ASKER: StubInsightHostOptions = { permissions: ["analytics:view", "langy:create"] };

type LastRun = NonNullable<InsightDailyRunSetting["lastRun"]>;

function ranToday(overrides: Partial<LastRun>): InsightDailyRunSetting {
  return {
    ...ON,
    lastRun: {
      at: NOW,
      outcome: "nothing",
      reason: null,
      filedCount: 0,
      renewedCount: 0,
      conversationId: null,
      runId: "run-1",
      ...overrides,
    },
  };
}

/** The clock time a run at `NOW` shows, read in the zone the run is set to. */
const RAN_AT = format(NOW, "HH:mm", { timeZone: AMSTERDAM });

/** The board as its header hands it over; "Add a widget" stands in for the board gaining one. */
function Board({
  kind = "dashboard",
  id = "board-1",
  widgets,
  witness = false,
}: {
  kind?: "dashboard" | "template";
  id?: string;
  /** "loading" while a stored board's widgets have not answered. */
  widgets: number | "loading";
  /** A second header for the same board with one widget: it draws once the shared read lands. */
  witness?: boolean;
}) {
  const [added, setAdded] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setAdded(added + 1)}>
        Add a widget
      </button>
      <button type="button" onClick={() => setAdded(added - 1)}>
        Delete a widget
      </button>
      <BoardDailyInsights
        boardKind={kind}
        boardId={id}
        boardName="Checkout health"
        widgetCount={widgets === "loading" ? void 0 : widgets + added}
      />
      {witness && (
        <section aria-label="Witness">
          <BoardDailyInsights
            boardKind={kind}
            boardId={id}
            boardName="Checkout health"
            widgetCount={1}
          />
        </section>
      )}
    </>
  );
}

function openBoard({
  setting = UNDECIDED,
  widgets = 3,
  entries = [],
  write = () => Promise.resolve(null),
  host: options = {},
  ...board
}: {
  /** What the read answers; a function answers what holds when the read is asked, or later. */
  setting?:
    | InsightDailyRunSetting
    | (() => InsightDailyRunSetting | Promise<InsightDailyRunSetting>);
  widgets?: number | "loading";
  entries?: InsightEntry[];
  /** How the server answers a write; it accepts unless a test says otherwise. */
  write?: (call: UiProcedureCall) => Promise<unknown>;
  host?: StubInsightHostOptions;
  kind?: "dashboard" | "template";
  id?: string;
  witness?: boolean;
} = {}) {
  const calls: UiProcedureCall[] = [];
  const { host, readHint, swapHost, unmount } = renderWithInsightHost({
    element: <Board widgets={widgets} {...board} />,
    host: new StubInsightHost(options),
    answer: (call) => {
      calls.push(call);
      if (call.path === READ) {
        return Promise.resolve(typeof setting === "function" ? setting() : setting);
      }
      if (call.path === "insights.getAll") return Promise.resolve(entries);
      if ([CONFIGURE, TURN_OFF, RUN_NOW].includes(call.path)) return write(call);
      return Promise.reject(new Error(`No test answer for ${call.path}`));
    },
  });
  const sent = (path: string) => calls.filter((call) => call.path === path).map((c) => c.input);
  return {
    host,
    readHint,
    swapHost,
    unmount,
    calls,
    reads: () => sent(READ),
    writes: () => [...sent(CONFIGURE), ...sent(TURN_OFF), ...sent(RUN_NOW)],
    sent,
    user: userEvent.setup({ pointerEventsCheck: 0 }),
  };
}

const quietControl = () => screen.queryByLabelText("Turn on daily insights");
const dropdownButton = () => screen.findByRole("button", { name: /^Daily insights: on/ });

async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await dropdownButton());
  return within(await screen.findByRole("dialog"));
}

/** Chooses Run now and waits for the server to take it; the board then waits on hints. */
async function chooseRunNow(board: ReturnType<typeof openBoard>) {
  const dropdown = await openDropdown(board.user);
  await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
  await waitFor(() => expect(board.sent(RUN_NOW)).toHaveLength(1));
}

describe("given a board with widgets and a member who never answered for it", () => {
  describe("when they open the board", () => {
    /** @scenario "A board a member never answered does not ask by itself" */
    it("opens no dialog, sends nothing, and shows the quiet control off", async () => {
      const board = openBoard();

      await waitFor(() => expect(quietControl()).toBeInTheDocument());
      expect(quietControl()).not.toBeChecked();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(board.reads()).toEqual([
        { projectId: "project-1", board: { kind: "dashboard", id: "board-1" } },
      ]);
      expect(board.writes()).toEqual([]);
    });
  });

  describe("when they turn it on from the quiet control", () => {
    /** @scenario "Turning on from the quiet control sends the hour, the zone and the maximum" */
    it("sets the run for hour 9, the browser's time zone and at most 3 insights", async () => {
      const board = openBoard();
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      await board.user.click(quietControl()!);

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toEqual([
          {
            projectId: "project-1",
            board: { kind: "dashboard", id: "board-1", name: "Checkout health" },
            hour: 9,
            timezone: currentTimeZone(),
            maxInsights: 3,
          },
        ]),
      );
      expect(await dropdownButton()).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("given a board with no widgets and a member who never answered for it", () => {
  describe("when they open the board", () => {
    /** @scenario "A board with no widgets shows no control" */
    it("opens no dialog and draws no control until its first widget lands", async () => {
      const board = openBoard({ widgets: 0, witness: true });
      const witness = within(screen.getByRole("region", { name: "Witness" }));
      // Both headers draw from one read, so the witness's switch means the read has landed.
      await witness.findByLabelText("Turn on daily insights");
      expect(screen.getAllByLabelText("Turn on daily insights")).toHaveLength(1);

      // The control shows once the board has something to read; the board opened without.
      await board.user.click(screen.getByRole("button", { name: "Add a widget" }));

      await waitFor(() =>
        expect(screen.getAllByLabelText("Turn on daily insights")).toHaveLength(2),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(board.writes()).toEqual([]);
    });
  });

  describe("when its widgets have not loaded yet", () => {
    /** @scenario "A board with no widgets shows no control" */
    it("draws no control and opens no dialog", async () => {
      const board = openBoard({ widgets: "loading" });
      await waitFor(() => expect(board.reads()).toHaveLength(1));

      expect(quietControl()).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("given a member turned a board off before choosing a run", () => {
  describe("when they open the board", () => {
    /** @scenario "A board that is off shows the quiet control" */
    it("shows the quiet control, no dialog, and turns on with the defaults", async () => {
      const board = openBoard({ setting: OFF_WITHOUT_CHOICES });
      await waitFor(() => expect(quietControl()).toBeInTheDocument());
      expect(screen.queryByRole("dialog")).toBeNull();

      await board.user.click(quietControl()!);

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toMatchObject([
          { hour: 9, timezone: currentTimeZone(), maxInsights: 3 },
        ]),
      );
    });
  });
});

describe("given a member turned a board's daily run off", () => {
  describe("when they turn it on from the control", () => {
    /** @scenario "A board that is off shows the quiet control" */
    it("sends what they last chose", async () => {
      const board = openBoard({
        setting: {
          state: "off",
          settings: { hour: 17, timezone: "Asia/Tokyo", maxInsights: 5 },
          lastRun: null,
          offReason: null,
          runInFlight: null,
        },
      });
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      await board.user.click(quietControl()!);

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toMatchObject([
          { hour: 17, timezone: "Asia/Tokyo", maxInsights: 5 },
        ]),
      );
    });
  });

  describe("when they open the board", () => {
    /** @scenario "A board its person turned off shows the quiet control and no reason" */
    it("shows the quiet switch and no notice", async () => {
      openBoard({ setting: { ...ON, state: "off" } });

      await waitFor(() => expect(quietControl()).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /^Daily insights/ })).toBeNull();
      expect(screen.queryByText(/Turned off/)).toBeNull();
    });
  });

  describe("when the server has not answered the write yet", () => {
    /** @scenario "The control changes before the server answers" */
    it("already shows the dropdown of a board that is on", async () => {
      const board = openBoard({
        setting: OFF_WITHOUT_CHOICES,
        write: () => new Promise(() => void 0),
      });
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      await board.user.click(quietControl()!);

      expect(await dropdownButton()).toBeInTheDocument();
      expect(quietControl()).toBeNull();
      expect(board.sent(CONFIGURE)).toHaveLength(1);
      expect(board.host.successes).toEqual([]);
    });
  });

  describe("when the server refuses the write", () => {
    /** @scenario "A refused write puts the control back and says so" */
    it("goes back to off and tells the member it could not be turned on", async () => {
      const board = openBoard({
        setting: OFF_WITHOUT_CHOICES,
        write: () => Promise.reject(new UiProcedureRefusal("dashboard_not_found", 404)),
      });
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      await board.user.click(quietControl()!);

      await waitFor(() => expect(board.host.failures).toHaveLength(1));
      expect(board.host.failures[0]?.fallbackTitle).toBe("Couldn't turn on daily insights");
      await waitFor(() => expect(quietControl()).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /^Daily insights: on/ })).toBeNull();
      expect(board.host.successes).toEqual([]);
    });
  });
});

describe("given a member turned a board's daily run on", () => {
  describe("when they open the dropdown in the board's header", () => {
    /** @scenario "A board that is on shows one dropdown" */
    it("says when the run reads the board, around its hour, and that no run happened yet", async () => {
      const board = openBoard({ setting: ON });

      const dropdown = await openDropdown(board.user);

      expect(
        dropdown.getByText(
          "Langy reads this board for you every day around 09:00 Amsterdam time and files what stands out, at most 3 insights per run.",
        ),
      ).toBeInTheDocument();
      expect(dropdown.getByText("No run yet.")).toBeInTheDocument();
      expect(quietControl()).toBeNull();
      expect(board.writes()).toEqual([]);
    });

    /** @scenario "A board that is on shows one dropdown" */
    it("leads to the member's inbox from Open Insights", async () => {
      const board = openBoard({ setting: ON });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByRole("button", { name: "Open Insights" }));

      expect(board.host.navigations).toEqual(["/acme/insights"]);
    });

    /** @scenario "A board that is on shows one dropdown" */
    it("opens the run's choices from Settings, and saving sends them", async () => {
      const board = openBoard({ setting: ON });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByRole("button", { name: "Settings" }));
      const settings = within(
        await screen.findByRole("dialog", { name: "Daily insights for Checkout health" }),
      );
      expect(settings.getByLabelText("Run time")).toHaveValue("9");
      expect(settings.getByLabelText("Time zone")).toHaveValue(AMSTERDAM);
      expect(within(settings.getByLabelText("Run time")).getAllByRole("option")).toHaveLength(24);
      expect(
        within(settings.getByLabelText("Most insights per run"))
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["1", "3", "5", "10"]);

      await board.user.selectOptions(settings.getByLabelText("Run time"), "07:00");
      await board.user.selectOptions(settings.getByLabelText("Time zone"), "Asia/Tokyo");
      await board.user.selectOptions(settings.getByLabelText("Most insights per run"), "10");
      await board.user.click(settings.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toEqual([
          {
            projectId: "project-1",
            board: { kind: "dashboard", id: "board-1", name: "Checkout health" },
            hour: 7,
            timezone: "Asia/Tokyo",
            maxInsights: 10,
          },
        ]),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    /** @scenario "A board that is on shows one dropdown" */
    it("sends an off from the switch in the dropdown, and shows the quiet control", async () => {
      const board = openBoard({ setting: ON });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByLabelText("Turn off daily insights"));

      await waitFor(() => expect(board.sent(TURN_OFF)).toHaveLength(1));
      await waitFor(() => expect(quietControl()).toBeInTheDocument());
      expect(board.sent(CONFIGURE)).toEqual([]);
    });
  });

  describe("when the board has 2 unseen insights and another board has 1", () => {
    /** @scenario "The control counts the board's unseen insights" */
    it("says 2 new", async () => {
      const from = (id: string, boardId: string) =>
        insightEntry({ id, board: { id: boardId, name: "A board", widget: null } });
      openBoard({
        setting: ON,
        entries: [from("i-1", "board-1"), from("i-2", "board-1"), from("i-3", "board-2")],
      });

      expect(
        await screen.findByRole("button", { name: "Daily insights: on, 2 new" }),
      ).toHaveTextContent("2 new");
    });
  });

  describe("when the board lost its last widget", () => {
    /** @scenario "A board that is on with no widgets waits" */
    it("says it waits, and that there is nothing to read", async () => {
      const board = openBoard({ setting: ON, widgets: 0 });

      expect(
        await screen.findByRole("button", { name: "Daily insights: on, waiting for a widget" }),
      ).toHaveTextContent("waiting");
      const dropdown = await openDropdown(board.user);

      expect(
        dropdown.getByText(
          "This board has no widgets, so Langy has nothing to read. Add a widget and the next run reads it.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when its last run ended", () => {
    /** @scenario "The dropdown says how the last run ended" */
    it.each([
      ["filed 2", { outcome: "filed", filedCount: 2 }, `Ran ${RAN_AT} · filed 2 new`],
      ["found nothing new", { outcome: "nothing" }, `Ran ${RAN_AT} · nothing new`],
      [
        "failed",
        { outcome: "failed", reason: "turn_failed" },
        `Failed ${RAN_AT} · nothing was filed, and the next run tries again`,
      ],
      ...INSIGHT_RUN_SKIP_REASONS.map(
        (reason) =>
          [
            `was skipped as ${reason}`,
            { outcome: "skipped", reason },
            `Did not run ${RAN_AT} · ${SKIP_REASON_WORDS[reason]}`,
          ] as const,
      ),
    ] as const)("says so for a run that %s", async (_name, lastRun, line) => {
      const board = openBoard({ setting: ranToday(lastRun) });

      const dropdown = await openDropdown(board.user);

      expect(dropdown.getByText(line)).toBeInTheDocument();
    });
  });
});

describe("given a member turned a board's daily run on, and may ask Langy", () => {
  describe("when they open the dropdown in the board's header", () => {
    /** @scenario "Run now is in the dropdown of a board that is on" */
    it("offers Run now", async () => {
      const board = openBoard({ setting: ON, host: ASKER });

      const dropdown = await openDropdown(board.user);

      expect(dropdown.getByRole("button", { name: "Run now" })).toBeInTheDocument();
      expect(board.writes()).toEqual([]);
    });

    /** @scenario "Run now is offered only on a board a run can read" */
    it("offers no Run now to a member who may not ask Langy", async () => {
      const board = openBoard({ setting: ON });

      const dropdown = await openDropdown(board.user);

      expect(dropdown.queryByRole("button", { name: "Run now" })).toBeNull();
    });

    /** @scenario "Run now is offered only on a board a run can read" */
    it.each<[string, BoardShape, boolean]>([
      ["a stored board with widgets", {}, true],
      ["a From LangWatch board", { kind: "template", id: "release" }, false],
      ["a board with no widgets", { widgets: 0 }, false],
      ["a board whose widgets have not loaded", { widgets: "loading" }, false],
    ])("on %s, offers Run now only where a run can read it", async (_name, shape, isOffered) => {
      const board = openBoard({ setting: ON, host: ASKER, ...shape });

      const dropdown = await openDropdown(board.user);

      expect(dropdown.queryAllByRole("button", { name: "Run now" })).toHaveLength(
        isOffered ? 1 : 0,
      );
    });
  });

  describe("when they choose Run now, with no run in flight", () => {
    /** @scenario "Run now asks for a run and opens Langy on it" */
    it("asks for a run on the board, and opens Langy on its conversation once it started", async () => {
      let hasStarted = false;
      const board = openBoard({
        setting: () => (hasStarted ? RUNNING : ON),
        host: ASKER,
        write: () => runNowAnswer(),
      });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(board.sent(RUN_NOW)).toHaveLength(1));
      expect(board.reads()).toHaveLength(1);
      expect(board.host.queries).toEqual([]);
      hasStarted = true;
      await board.readHint();

      await waitFor(() =>
        expect(board.host.queries).toEqual([{ langyConversation: "conversation-7" }]),
      );
      expect(board.sent(RUN_NOW)).toEqual([
        {
          projectId: "project-1",
          board: { kind: "dashboard", id: "board-1", name: "Checkout health" },
          maxInsights: 3,
        },
      ]);
      expect(board.host.failures).toEqual([]);
    });
  });

  describe("when the start's hint reaches the board before the worker stored the run", () => {
    /** @scenario "Run now opens Langy when the start's hint arrives before its run is stored" */
    it("keeps waiting on that read, and opens Langy on the run once a later hint's read shows it", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let isStored = false;
        const board = openBoard({
          setting: () => (isStored ? RUNNING : ON),
          host: ASKER,
          write: () => runNowAnswer(),
        });
        await chooseRunNow(board);

        await board.readHint();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(board.reads()).toHaveLength(2);
        expect(board.host.queries).toEqual([]);
        isStored = true;
        await board.readHint();

        await waitFor(() =>
          expect(board.host.queries).toEqual([{ langyConversation: "conversation-7" }]),
        );
        expect(board.reads()).toHaveLength(3);
        await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS);
        expect(board.reads()).toHaveLength(3);
        expect(board.host.failures).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when a scheduled run settled before they chose Run now, and the board had not read it", () => {
    /** @scenario "Run now waits for the run it asked for, not one that settled before the click" */
    it("keeps waiting, and opens Langy on the run it asked for once that starts", async () => {
      let read = ON;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => {
          read = ranToday({ runId: "run-scheduled", conversationId: "conversation-6" });
          return runNowAnswer();
        },
      });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(board.sent(RUN_NOW)).toHaveLength(1));
      await board.readHint();
      const waiting = await openDropdown(board.user);
      // The scheduled run shows as the last run, and the board still waits for its own.
      expect(await waiting.findByText(`Ran ${RAN_AT} · nothing new`)).toBeInTheDocument();
      expect(waiting.getByText("Starting a run.")).toBeInTheDocument();
      expect(waiting.queryByRole("button", { name: "Run now" })).toBeNull();
      expect(board.host.queries).toEqual([]);
      read = { ...ranToday({ runId: "run-scheduled" }), runInFlight: RUNNING.runInFlight };
      await board.readHint();

      await waitFor(() =>
        expect(board.host.queries).toEqual([{ langyConversation: "conversation-7" }]),
      );
      expect(board.host.failures).toEqual([]);
    });
  });

  describe("when another run starts after the server took Run now, so the request starts none", () => {
    /** @scenario "Run now follows a run that started after the click" */
    it("follows that run by the server's time, though the browser's clock is ahead", async () => {
      let read = ON;
      // The server's clock is 10 minutes behind the browser's.
      const requestedAt = nowInstant().epochMilliseconds - 10 * 60_000;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => runNowAnswer({ requestedAt }),
      });
      const dropdown = await openDropdown(board.user);
      await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(board.sent(RUN_NOW)).toHaveLength(1));

      // Another tab's request, or the schedule's wake, holds the run the process starts.
      const startedAt = requestedAt + 1_000;
      read = {
        ...ON,
        runInFlight: { runId: "request-2", conversationId: "conversation-9", startedAt },
      };
      await board.readHint();

      await waitFor(() =>
        expect(board.host.queries).toEqual([{ langyConversation: "conversation-9" }]),
      );
      const following = await openDropdown(board.user);
      expect(following.getByText("A run is going.")).toBeInTheDocument();
      expect(following.queryByText("Starting a run.")).toBeNull();
      expect(board.host.failures).toEqual([]);
    });
  });

  describe("when the board's run in flight was lost, and is settled before their run starts", () => {
    /** @scenario "Run now waits past a lost run settled before its own starts" */
    it("keeps waiting through the lost run's outcome, then opens Langy on its own run", async () => {
      let read = ON;
      const requestedAt = nowInstant().epochMilliseconds;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => runNowAnswer({ requestedAt }),
      });
      const dropdown = await openDropdown(board.user);
      await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(board.sent(RUN_NOW)).toHaveLength(1));

      // The worker records the lost run's timeout, with no conversation, before it starts ours.
      const lost = ranToday({
        at: requestedAt + 1_000,
        outcome: "failed",
        reason: "timeout",
        runId: "run-lost",
      });
      read = lost;
      await board.readHint();
      const waiting = await openDropdown(board.user);
      expect(waiting.getByText("Starting a run.")).toBeInTheDocument();
      expect(board.host.queries).toEqual([]);

      read = {
        ...lost,
        runInFlight: {
          runId: "request-1",
          conversationId: "conversation-7",
          startedAt: requestedAt + 2_000,
        },
      };
      await board.readHint();

      await waitFor(() =>
        expect(board.host.queries).toEqual([{ langyConversation: "conversation-7" }]),
      );
      expect(board.host.failures).toEqual([]);
    });
  });

  describe("when they turn the run off while waiting for the run they asked for", () => {
    async function turnedOffMidWait(board: ReturnType<typeof openBoard>) {
      await chooseRunNow(board);
      const dropdown = await openDropdown(board.user);
      await board.user.click(dropdown.getByLabelText("Turn off daily insights"));
      await waitFor(() => expect(board.sent(TURN_OFF)).toHaveLength(1));
      await waitFor(() => expect(quietControl()).toBeInTheDocument());
    }

    /** @scenario "Turning the run off ends the wait for a requested run" */
    it.each<[string, InsightDailyRunSetting]>([
      ["in flight", { ...RUNNING, state: "off" }],
      ["settled", { ...ranToday({ runId: "request-1" }), state: "off" }],
    ])(
      "opens nothing and says nothing for a run shown %s, not even at the deadline",
      async (_name, late) => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          let read = ON;
          const board = openBoard({
            setting: () => read,
            host: ASKER,
            write: () => runNowAnswer(),
          });
          await turnedOffMidWait(board);

          read = late;
          await board.readHint();
          await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS);

          expect(board.host.queries).toEqual([]);
          expect(board.host.notices).toEqual([]);
          expect(board.host.failures).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      },
    );

    /** @scenario "Turning the run off ends the wait for a requested run" */
    it("shows no wait when they turn it on again, and offers Run now", async () => {
      const board = openBoard({ setting: ON, host: ASKER, write: () => runNowAnswer() });
      await turnedOffMidWait(board);

      await board.user.click(quietControl()!);

      const dropdown = await openDropdown(board.user);
      expect(dropdown.queryByText("Starting a run.")).toBeNull();
      expect(dropdown.getByRole("button", { name: "Run now" })).toBeInTheDocument();
    });

    /** @scenario "Turning the run off ends the wait even when the write is refused" */
    it("opens nothing and starts no failure for the run, though the server refuses the turn-off", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let read = ON;
        const board = openBoard({
          setting: () => read,
          host: ASKER,
          write: (call) =>
            call.path === TURN_OFF
              ? Promise.reject(new UiProcedureRefusal("forbidden", 403))
              : runNowAnswer(),
        });
        await chooseRunNow(board);
        const dropdown = await openDropdown(board.user);
        await board.user.click(dropdown.getByLabelText("Turn off daily insights"));
        await waitFor(() => expect(board.host.failures).toHaveLength(1));

        read = RUNNING;
        await board.readHint();
        await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS);

        expect(board.host.queries).toEqual([]);
        expect(board.host.notices).toEqual([]);
        expect(board.host.failures.map((failure) => failure.fallbackTitle)).toEqual([
          "Couldn't turn off daily insights",
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    /** @scenario "Turning the run off before Run now answers ends the wait" */
    it("shows no failure when the server then refuses Run now", async () => {
      let refuseRunNow: (() => void) | undefined;
      const board = openBoard({
        setting: ON,
        host: ASKER,
        write: (call) =>
          call.path === RUN_NOW
            ? new Promise(
                (_, reject) =>
                  (refuseRunNow = () => reject(new UiProcedureRefusal("forbidden", 403))),
              )
            : Promise.resolve(null),
      });
      await chooseRunNow(board);
      const dropdown = await openDropdown(board.user);
      await board.user.click(dropdown.getByLabelText("Turn off daily insights"));
      await waitFor(() => expect(board.sent(TURN_OFF)).toHaveLength(1));
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      refuseRunNow?.();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(board.host.failures).toEqual([]);
      expect(board.host.queries).toEqual([]);
    });

    /** @scenario "Turning the run off before Run now answers ends the wait" */
    it("opens nothing and says nothing when Run now answers after the turn-off was sent", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let read = ON;
        let answerRunNow: (() => void) | undefined;
        const board = openBoard({
          setting: () => read,
          host: ASKER,
          write: (call) =>
            call.path === RUN_NOW
              ? new Promise((resolve) => (answerRunNow = () => resolve(runNowAnswer())))
              : Promise.resolve(null),
        });
        await chooseRunNow(board);
        const dropdown = await openDropdown(board.user);
        await board.user.click(dropdown.getByLabelText("Turn off daily insights"));
        await waitFor(() => expect(board.sent(TURN_OFF)).toHaveLength(1));
        await waitFor(() => expect(quietControl()).toBeInTheDocument());

        answerRunNow?.();
        read = { ...RUNNING, state: "off" };
        await board.readHint();
        await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS);

        expect(board.host.queries).toEqual([]);
        expect(board.host.notices).toEqual([]);
        expect(board.host.failures).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when the board loses its last widget while they wait for the run they asked for", () => {
    /** @scenario "Starting a run still shows after the last widget is deleted" */
    it("still says a run is starting, and offers no Run now", async () => {
      const board = openBoard({
        setting: ON,
        widgets: 1,
        host: ASKER,
        write: () => runNowAnswer(),
      });
      await chooseRunNow(board);

      await board.user.click(screen.getByRole("button", { name: "Delete a widget" }));

      const dropdown = await openDropdown(board.user);
      expect(dropdown.getByText("Starting a run.")).toBeInTheDocument();
      expect(dropdown.queryByRole("button", { name: "Run now" })).toBeNull();
    });
  });

  describe("when a run is in flight and they open the dropdown", () => {
    /** @scenario "A run in flight is opened, not started again" */
    it("says a run is going and offers to open it in Langy, not Run now", async () => {
      const board = openBoard({ setting: RUNNING, host: ASKER });

      const dropdown = await openDropdown(board.user);

      expect(dropdown.getByText("A run is going.")).toBeInTheDocument();
      expect(dropdown.queryByRole("button", { name: "Run now" })).toBeNull();
      await board.user.click(dropdown.getByRole("button", { name: "Open in Langy" }));

      expect(board.host.queries).toEqual([{ langyConversation: "conversation-7" }]);
      expect(board.writes()).toEqual([]);
    });
  });

  describe("when the server refuses Run now", () => {
    /** @scenario "A refused Run now says so" */
    it("tells the member the run could not be started, and offers Run now again", async () => {
      const board = openBoard({
        setting: ON,
        host: ASKER,
        write: () => Promise.reject(new UiProcedureRefusal("insights_not_enabled", 403)),
      });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByRole("button", { name: "Run now" }));

      await waitFor(() => expect(board.host.failures).toHaveLength(1));
      expect(board.host.failures[0]?.fallbackTitle).toBe("Couldn't start the run");
      const again = await openDropdown(board.user);
      expect(again.getByRole("button", { name: "Run now" })).toBeInTheDocument();
      expect(board.host.queries).toEqual([]);
    });
  });

  describe("when the run they asked for settles with no conversation", () => {
    /** @scenario "A requested run that ends with no conversation says how it ended" */
    it.each<[string, RanOverrides, string]>([
      [
        "on a quiet project",
        { outcome: "nothing", reason: "no_new_traces" },
        "The run ended: no new traces, so Langy was not asked.",
      ],
      ["with nothing new", { outcome: "nothing" }, "The run ended: nothing new."],
      [
        "with 2 filed and 1 seen again",
        { outcome: "filed", filedCount: 2, renewedCount: 1 },
        "The run ended: filed 2 new, seen again 1.",
      ],
      [
        "skipped as no_access",
        { outcome: "skipped", reason: "no_access" },
        `The run did not start: ${SKIP_REASON_WORDS.no_access}.`,
      ],
      [
        "skipped as langy_off",
        { outcome: "skipped", reason: "langy_off" },
        `The run did not start: ${SKIP_REASON_WORDS.langy_off}.`,
      ],
      [
        "failed before reaching Langy",
        { outcome: "failed", reason: "brief_changed" },
        "The run failed: nothing was filed, and the next run tries again.",
      ],
    ])("says how it ended %s, and opens nothing", async (_name, lastRun, words) => {
      let read = ON;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => runNowAnswer(),
      });
      await chooseRunNow(board);

      read = ranToday({ ...lastRun, runId: "request-1" });
      await board.readHint();

      await waitFor(() => expect(board.host.notices).toEqual([{ title: words }]));
      expect(board.host.queries).toEqual([]);
      expect(board.host.failures).toEqual([]);
      expect(board.host.successes).toEqual([]);
      const again = await openDropdown(board.user);
      expect(again.getByRole("button", { name: "Run now" })).toBeInTheDocument();
      expect(board.host.notices).toHaveLength(1);
    });
  });

  describe("when the board has read no run for as long as a run can last", () => {
    /** The read the board opened with: no timer reads before the deadline. */
    const READS_BEFORE_DEADLINE = 1;

    beforeEach(() => void vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => void vi.useRealTimers());

    async function aMinuteBeforeTheDeadline(board: ReturnType<typeof openBoard>) {
      await chooseRunNow(board);
      await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS - 60_000);
      expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE);
      expect(board.host.failures).toEqual([]);
    }

    /** @scenario "The deadline follows a run its last read finds" */
    it.each<[string, InsightDailyRunSetting, LangyQuery[], Notice[]]>([
      ["opens Langy on a run in flight", RUNNING, [{ langyConversation: "conversation-7" }], []],
      [
        "says how a run with no conversation ended",
        ranToday({ outcome: "skipped", reason: "langy_off", runId: "request-1" }),
        [],
        [{ title: `The run did not start: ${SKIP_REASON_WORDS.langy_off}.` }],
      ],
    ])(
      "ends the spinner at expiry, %s, and reports no failure",
      async (_name, shown, queries, notices) => {
        let read = ON;
        let answerRead: (() => void) | undefined;
        let isHeld = false;
        const board = openBoard({
          setting: () =>
            isHeld
              ? new Promise<InsightDailyRunSetting>(
                  (resolve) => (answerRead = () => resolve(shown)),
                )
              : read,
          host: ASKER,
          write: () => runNowAnswer(),
        });
        await aMinuteBeforeTheDeadline(board);

        isHeld = true;
        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1));
        // The spinner is gone before the read answers, and nothing was said.
        expect((await openDropdown(board.user)).queryByText("Starting a run.")).toBeNull();
        expect(board.host.queries).toEqual([]);
        expect(board.host.failures).toEqual([]);

        answerRead?.();
        await waitFor(() => {
          expect(board.host.queries).toEqual(queries);
          expect(board.host.notices).toEqual(notices);
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(board.host.failures).toEqual([]);
        expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1);
      },
    );

    /** @scenario "The deadline read is replaced by a later hint's read" */
    it("ends the spinner at expiry and says nothing, and a later hint's read then gives the verdict", async () => {
      let read: InsightDailyRunSetting | Promise<InsightDailyRunSetting> = ON;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => runNowAnswer(),
      });
      await aMinuteBeforeTheDeadline(board);

      read = new Promise<InsightDailyRunSetting>(() => void 0);
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1));
      // A minute short of the full lifetime: the later read still lands inside the window.
      await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS - 60_000);

      const waiting = await openDropdown(board.user);
      expect(waiting.queryByText("Starting a run.")).toBeNull();
      expect(board.host.failures).toEqual([]);
      expect(board.host.notices).toEqual([]);
      expect(board.host.queries).toEqual([]);

      read = RUNNING;
      await board.readHint();
      expect(await waiting.findByText("A run is going.")).toBeInTheDocument();
      // The hint's read replaces the one that never answered, so the owed verdict follows it.
      await waitFor(() => expect(board.host.queries).toHaveLength(1));
      await board.readHint();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(board.host.queries).toEqual([{ langyConversation: "conversation-7" }]);
      expect(board.host.failures).toEqual([]);
      expect(board.host.notices).toEqual([]);
    });

    /** @scenario "A read that lands a run's lifetime after the deadline gives no verdict" */
    it("says nothing and opens nothing when a hint's read lands after the run could have lasted", async () => {
      let read: InsightDailyRunSetting | Promise<InsightDailyRunSetting> = ON;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => runNowAnswer(),
      });
      await aMinuteBeforeTheDeadline(board);

      read = new Promise<InsightDailyRunSetting>(() => void 0);
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1));
      await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS + 1_000);

      // No run in the read: a hint that outran its row, not a loss to report.
      read = ON;
      await board.readHint();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(board.host.queries).toEqual([]);
      expect(board.host.failures).toEqual([]);
      expect(board.host.notices).toEqual([]);
    });

    /** @scenario "A run that started after the deadline gives no verdict" */
    it("says nothing and opens nothing when a hint's read shows a scheduled run that started after the deadline", async () => {
      let read: InsightDailyRunSetting | Promise<InsightDailyRunSetting> = ON;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => runNowAnswer(),
      });
      await aMinuteBeforeTheDeadline(board);

      read = new Promise<InsightDailyRunSetting>(() => void 0);
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1));
      // Inside the window, so only the start time tells it from the request's own run.
      await vi.advanceTimersByTimeAsync(30 * 60_000);

      read = {
        ...ON,
        runInFlight: {
          runId: "run-scheduled",
          conversationId: "conversation-9",
          startedAt: Date.now(),
        },
      };
      await board.readHint();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(board.host.queries).toEqual([]);
      expect(board.host.failures).toEqual([]);
      expect(board.host.notices).toEqual([]);
    });

    /** Opens a board whose deadline read is held until `answer` is called, with `shown`. */
    async function pastTheDeadlineWithReadHeld(
      write: (call: UiProcedureCall) => Promise<unknown>,
      shown: InsightDailyRunSetting,
    ) {
      let isHeld = false;
      let answer: () => void = () => void 0;
      const board = openBoard({
        setting: () =>
          isHeld
            ? new Promise<InsightDailyRunSetting>((resolve) => (answer = () => resolve(shown)))
            : ON,
        host: ASKER,
        write,
      });
      await aMinuteBeforeTheDeadline(board);
      isHeld = true;
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1));
      return { board, answer: () => answer() };
    }

    /** What the read shows when the owed verdict would be found, and when it would be lost. */
    const STALE_VERDICTS: [string, InsightDailyRunSetting][] = [
      ["a run", RUNNING],
      ["no run", ON],
    ];

    /** @scenario "Turning the run off after the deadline fired drops the verdict its read owes" */
    it.each(STALE_VERDICTS)(
      "shows nothing when the read answers %s after the turn-off",
      async (_name, shown) => {
        const { board, answer } = await pastTheDeadlineWithReadHeld(
          (call) => (call.path === TURN_OFF ? Promise.resolve(undefined) : runNowAnswer()),
          shown,
        );
        const dropdown = await openDropdown(board.user);
        await board.user.click(dropdown.getByLabelText("Turn off daily insights"));
        await waitFor(() => expect(board.sent(TURN_OFF)).toHaveLength(1));

        answer();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(board.host.queries).toEqual([]);
        expect(board.host.notices).toEqual([]);
        expect(board.host.failures).toEqual([]);
      },
    );

    /** @scenario "Leaving the board after the deadline fired drops the verdict its read owes" */
    it.each(STALE_VERDICTS)(
      "shows nothing when the read answers %s after the board is left",
      async (_name, shown) => {
        const { board, answer } = await pastTheDeadlineWithReadHeld(() => runNowAnswer(), shown);

        board.unmount();
        answer();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(board.host.queries).toEqual([]);
        expect(board.host.notices).toEqual([]);
        expect(board.host.failures).toEqual([]);
      },
    );

    /** @scenario "A second Run now drops the verdict the earlier deadline read owes" */
    it.each(STALE_VERDICTS)(
      "shows nothing for the old request when its read answers %s after a second click",
      async (_name, shown) => {
        let runNowCalls = 0;
        const { board, answer } = await pastTheDeadlineWithReadHeld((call) => {
          if (call.path !== RUN_NOW) return Promise.resolve(undefined);
          runNowCalls += 1;
          return runNowAnswer({ requestId: `request-${runNowCalls}` });
        }, shown);
        const dropdown = await openDropdown(board.user);
        await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
        await waitFor(() => expect(board.sent(RUN_NOW)).toHaveLength(2));

        answer();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(board.host.queries).toEqual([]);
        expect(board.host.notices).toEqual([]);
        expect(board.host.failures).toEqual([]);
      },
    );

    /** @scenario "The deadline says the run could not be started when its last read finds none" */
    it("says so once, after one more read, and offers Run now again", async () => {
      const board = openBoard({ setting: ON, host: ASKER, write: () => runNowAnswer() });
      await aMinuteBeforeTheDeadline(board);

      await vi.advanceTimersByTimeAsync(60_000);

      await waitFor(() => expect(board.host.failures).toHaveLength(1));
      expect(board.host.failures[0]?.fallbackTitle).toBe("Couldn't start the run");
      expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(board.host.failures).toHaveLength(1);
      const again = await openDropdown(board.user);
      expect(again.getByRole("button", { name: "Run now" })).toBeInTheDocument();
      expect(board.host.queries).toEqual([]);
    });

    /** @scenario "The deadline does not move when the page's host is rebuilt" */
    it("says so once at its own time, on the newest host, though a new host came a minute before", async () => {
      const board = openBoard({ setting: ON, host: ASKER, write: () => runNowAnswer() });
      await aMinuteBeforeTheDeadline(board);

      const rebuilt = new StubInsightHost(ASKER);
      board.swapHost(rebuilt);
      await vi.advanceTimersByTimeAsync(50_000);
      expect(rebuilt.failures).toEqual([]);
      await vi.advanceTimersByTimeAsync(10_000);

      await waitFor(() => expect(rebuilt.failures).toHaveLength(1));
      expect(board.host.failures).toEqual([]);
      expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1);
      await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS);
      expect(rebuilt.failures).toHaveLength(1);
      expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1);
    });

    /** @scenario "The deadline says so once when its last read fails" */
    it("says so once, and reads no more", async () => {
      let answerRead: ReadAnswer = () => ON;
      const board = openBoard({
        setting: () => answerRead(),
        host: ASKER,
        write: () => runNowAnswer(),
      });
      await aMinuteBeforeTheDeadline(board);

      answerRead = READ_REFUSED;
      await vi.advanceTimersByTimeAsync(60_000);

      await waitFor(() => expect(board.host.failures).toHaveLength(1));
      expect(board.host.failures[0]?.fallbackTitle).toBe("Couldn't start the run");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(board.host.failures).toHaveLength(1);
      expect(board.reads()).toHaveLength(READS_BEFORE_DEADLINE + 1);
      expect(board.host.queries).toEqual([]);
    });

    /** @scenario "A run that shows after the deadline gave up opens nothing and says nothing" */
    it.each<[string, InsightDailyRunSetting, RegExp]>([
      ["in flight", RUNNING, /^A run is going\.$/],
      [
        "settled with no conversation",
        ranToday({ outcome: "nothing", reason: "no_new_traces", runId: "request-1" }),
        /no new traces, so Langy was not asked$/,
      ],
    ])("opens nothing and says nothing for a run shown %s", async (_name, late, line) => {
      let read = ON;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => runNowAnswer(),
      });
      await aMinuteBeforeTheDeadline(board);
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(board.host.failures).toHaveLength(1));

      read = late;
      await board.readHint();

      const after = await openDropdown(board.user);
      expect(await after.findByText(line)).toBeInTheDocument();
      expect(board.host.queries).toEqual([]);
      expect(board.host.notices).toEqual([]);
      expect(board.host.successes).toEqual([]);
      expect(board.host.failures).toHaveLength(1);
    });
  });
});

describe("given a board whose daily run the system turned off after 7 skipped days", () => {
  const TURNED_OFF: InsightDailyRunSetting = {
    ...ranToday({ outcome: "skipped", reason: "no_access" }),
    state: "off",
    settings: { hour: 17, timezone: AMSTERDAM, maxInsights: 5 },
    offReason: "skipped_days",
  };
  const turnedOffButton = () => screen.findByRole("button", { name: "Daily insights: turned off" });

  describe("when the member opens the control in the board's header", () => {
    let board: ReturnType<typeof openBoard>;
    let dropdown: ReturnType<typeof within>;

    beforeEach(async () => {
      board = openBoard({ setting: TURNED_OFF });
      await board.user.click(await turnedOffButton());
      dropdown = within(await screen.findByRole("dialog"));
    });

    /** @scenario "A board the system turned off says why and can be turned on again" */
    it("says the run was turned off and why, and how the last run ended", () => {
      expect(dropdown.getByText(OFF_REASON_WORDS.skipped_days)).toBeInTheDocument();
      expect(
        dropdown.getByText(`Did not run ${RAN_AT} · ${SKIP_REASON_WORDS.no_access}`),
      ).toBeInTheDocument();
      expect(dropdown.getByLabelText("Turn on daily insights")).not.toBeChecked();
      expect(dropdown.queryByText("Settings")).toBeNull();
      expect(board.writes()).toEqual([]);
    });

    /** @scenario "A board the system turned off says why and can be turned on again" */
    it("sends what they last chose when they turn it on from the control", async () => {
      await board.user.click(dropdown.getByLabelText("Turn on daily insights"));

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toMatchObject([
          { hour: 17, timezone: AMSTERDAM, maxInsights: 5 },
        ]),
      );
      // The write shows before the server answers: the board is on, and the reason is gone.
      expect(await dropdownButton()).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Daily insights: turned off" })).toBeNull();
    });
  });
});

describe("given a From LangWatch board", () => {
  describe("when a member turns its daily run on", () => {
    /** @scenario "A From LangWatch board takes the control and is named by its template id" */
    it("reads and sets it with the kind template and the template's id", async () => {
      const board = openBoard({ kind: "template", id: "release" });
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      await board.user.click(quietControl()!);

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toMatchObject([
          { board: { kind: "template", id: "release", name: "Checkout health" } },
        ]),
      );
      expect(board.reads()).toEqual([
        { projectId: "project-1", board: { kind: "template", id: "release" } },
      ]);
    });
  });

  describe("when a member turns it on from the quiet control", () => {
    /** @scenario "Turning on a From LangWatch board says no run reads it yet" */
    it("says that a run on this board files nothing for now, and promises no daily read", async () => {
      const board = openBoard({ kind: "template", id: "release" });
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      await board.user.click(quietControl()!);

      await waitFor(() =>
        expect(board.host.successes).toEqual([
          {
            title:
              "Daily insights on. Langy cannot read From LangWatch boards yet. Until it can, a run on this board files nothing.",
          },
        ]),
      );
    });

    /** @scenario "Turning on a From LangWatch board says no run reads it yet" */
    it("promises the daily read on a stored board", async () => {
      const board = openBoard();
      await waitFor(() => expect(quietControl()).toBeInTheDocument());

      await board.user.click(quietControl()!);

      await waitFor(() => expect(board.host.successes).toHaveLength(1));
      expect(board.host.successes[0]?.title).toMatch(
        /^Daily insights on\. Langy reads this board every day /,
      );
    });
  });

  describe("when a member that turned it on opens Settings", () => {
    async function openSettings(board: ReturnType<typeof openBoard>) {
      const dropdown = await openDropdown(board.user);
      await board.user.click(dropdown.getByRole("button", { name: "Settings" }));
      return within(
        await screen.findByRole("dialog", { name: "Daily insights for Checkout health" }),
      );
    }

    /** @scenario "A From LangWatch board's settings say no run reads it yet" */
    it("says that a run on this board files nothing for now", async () => {
      const settings = await openSettings(
        openBoard({ kind: "template", id: "release", setting: ON }),
      );

      expect(
        settings.getByText(
          "Langy cannot read From LangWatch boards yet. Until it can, a run on this board files nothing.",
        ),
      ).toBeInTheDocument();
    });

    /** @scenario "A From LangWatch board's settings say no run reads it yet" */
    it("says no such thing on a stored board", async () => {
      const settings = await openSettings(openBoard({ setting: ON }));

      expect(settings.queryByText(/cannot read From LangWatch boards/)).toBeNull();
    });
  });

  describe("when its run was skipped because no server reads a template yet", () => {
    /** @scenario "A From LangWatch board takes the control and is named by its template id" */
    it("says calmly that Langy cannot read From LangWatch boards yet", async () => {
      const board = openBoard({
        kind: "template",
        id: "release",
        setting: ranToday({ outcome: "skipped", reason: "template_board" }),
      });

      const dropdown = await openDropdown(board.user);

      expect(
        dropdown.getByText(`Did not run ${RAN_AT} · Langy cannot read From LangWatch boards yet`),
      ).toBeInTheDocument();
      expect(board.host.failures).toEqual([]);
    });
  });
});

describe("given a board whose header is drawn where insights are not available", () => {
  /** @scenario "The control is absent without the flag, the grant or a project that takes runs" */
  it.each<[string, StubInsightHostOptions]>([
    ["the release_insights flag is off", { enabled: false }],
    ["the flag has not answered yet", { enabled: undefined }],
    ["the member has no analytics:view", { permissions: [] }],
    [
      "the project is an aggregate",
      { project: { id: "project-1", slug: "acme", kind: "aggregate" } },
    ],
    ["no project is in scope", { project: undefined }],
  ])("shows no control, opens no dialog and asks the server nothing when %s", async (_, host) => {
    const board = openBoard({ host });

    // A control that were coming would have asked for its read by now.
    await board.user.click(screen.getByRole("button", { name: "Add a widget" }));

    expect(screen.queryByText("Daily insights")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(board.calls).toEqual([]);
  });
});
