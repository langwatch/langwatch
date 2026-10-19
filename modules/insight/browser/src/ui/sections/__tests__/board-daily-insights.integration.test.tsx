/**
 * @vitest-environment jsdom
 * "Daily insights" in a board's header over the real tRPC hooks: the offer, the three states,
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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { REQUESTED_RUN_REREAD_MS } from "../../../behavior/use-board-daily-insights.ts";
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
const OFFER = "Turn on daily insights for Checkout health?";

const NOTHING_YET = { settings: null, lastRun: null, offReason: null, runInFlight: null };
const UNDECIDED: InsightDailyRunSetting = { state: "undecided", ...NOTHING_YET };
const DECLINED: InsightDailyRunSetting = { state: "off", ...NOTHING_YET };
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
}: {
  kind?: "dashboard" | "template";
  id?: string;
  /** "loading" while a stored board's widgets have not answered. */
  widgets: number | "loading";
}) {
  const [added, setAdded] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setAdded(added + 1)}>
        Add a widget
      </button>
      <BoardDailyInsights
        boardKind={kind}
        boardId={id}
        boardName="Checkout health"
        widgetCount={widgets === "loading" ? void 0 : widgets + added}
      />
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
  /** What the read answers; a function answers what holds when the read is asked. */
  setting?: InsightDailyRunSetting | (() => InsightDailyRunSetting);
  widgets?: number | "loading";
  entries?: InsightEntry[];
  /** How the server answers a write; it accepts unless a test says otherwise. */
  write?: (call: UiProcedureCall) => Promise<unknown>;
  host?: StubInsightHostOptions;
  kind?: "dashboard" | "template";
  id?: string;
} = {}) {
  const calls: UiProcedureCall[] = [];
  const { host, readHint } = renderWithInsightHost({
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

describe("given a board with widgets and a member who never answered for it", () => {
  describe("when they open the board", () => {
    /** @scenario "A board a member never answered offers daily insights" */
    it("asks whether to turn on daily insights for that board, with the quiet control behind it", async () => {
      const board = openBoard();

      expect(await screen.findByRole("dialog", { name: OFFER })).toBeInTheDocument();
      expect(quietControl()).not.toBeChecked();
      expect(board.reads()).toEqual([
        { projectId: "project-1", board: { kind: "dashboard", id: "board-1" } },
      ]);
      expect(board.writes()).toEqual([]);
    });
  });

  describe("when they close the offer without an answer", () => {
    /** @scenario "Closing the offer decides nothing" */
    it("sends nothing, and keeps the offer closed for the visit", async () => {
      const board = openBoard();
      const offer = await screen.findByRole("dialog", { name: OFFER });

      await board.user.click(within(offer).getByRole("button", { name: "Close" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(quietControl()).toBeInTheDocument();
      expect(board.writes()).toEqual([]);
      expect(board.host.successes).toEqual([]);
    });
  });

  describe("when they say no thanks", () => {
    /** @scenario "No thanks on the offer sends an off for the board" */
    it("sends an off for that board and closes the offer", async () => {
      const board = openBoard();
      const offer = await screen.findByRole("dialog", { name: OFFER });

      await board.user.click(within(offer).getByRole("button", { name: "No thanks" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() =>
        expect(board.sent(TURN_OFF)).toEqual([
          {
            projectId: "project-1",
            board: { kind: "dashboard", id: "board-1", name: "Checkout health" },
          },
        ]),
      );
      expect(board.sent(CONFIGURE)).toEqual([]);
      expect(quietControl()).toBeInTheDocument();
    });
  });

  describe("when they turn it on as offered", () => {
    /** @scenario "Turning on from the offer sends the hour, the zone and the maximum" */
    it("sets the run for hour 9, the browser's time zone and at most 3 insights", async () => {
      const board = openBoard();
      const offer = await screen.findByRole("dialog", { name: OFFER });

      await board.user.click(within(offer).getByRole("button", { name: "Turn on" }));

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

  describe("when they choose another hour, zone and maximum first", () => {
    /** @scenario "Turning on from the offer sends the hour, the zone and the maximum" */
    it("sends what they chose", async () => {
      const board = openBoard();
      const offer = within(await screen.findByRole("dialog", { name: OFFER }));
      expect(within(offer.getByLabelText("Run time")).getAllByRole("option")).toHaveLength(24);
      expect(
        within(offer.getByLabelText("Most insights per run"))
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["1", "3", "5", "10"]);

      await board.user.selectOptions(offer.getByLabelText("Run time"), "23:00");
      await board.user.selectOptions(offer.getByLabelText("Time zone"), "Asia/Tokyo");
      await board.user.selectOptions(offer.getByLabelText("Most insights per run"), "10");
      await board.user.click(offer.getByRole("button", { name: "Turn on" }));

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toMatchObject([
          { hour: 23, timezone: "Asia/Tokyo", maxInsights: 10 },
        ]),
      );
    });
  });
});

describe("given a board with no widgets and a member who never answered for it", () => {
  describe("when they open the board", () => {
    /** @scenario "A board with no widgets offers nothing" */
    it("opens no offer and draws no control, also once its first widget lands", async () => {
      const board = openBoard({ widgets: 0 });
      await waitFor(() => expect(board.reads()).toHaveLength(1));

      // The control shows once the board has something to read; the board opened without.
      await board.user.click(screen.getByRole("button", { name: "Add a widget" }));

      await waitFor(() => expect(quietControl()).toBeInTheDocument());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(board.writes()).toEqual([]);
    });
  });

  describe("when its widgets have not loaded yet", () => {
    /** @scenario "A board with no widgets offers nothing" */
    it("draws no control and opens no offer", async () => {
      const board = openBoard({ widgets: "loading" });
      await waitFor(() => expect(board.reads()).toHaveLength(1));

      expect(quietControl()).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});

describe("given a member said no thanks to a board", () => {
  describe("when they open the board", () => {
    /** @scenario "A board that is off shows the quiet control and no offer" */
    it("shows the quiet control, no offer, and turns on with the defaults", async () => {
      const board = openBoard({ setting: DECLINED });
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
    /** @scenario "A board that is off shows the quiet control and no offer" */
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
      const board = openBoard({ setting: DECLINED, write: () => new Promise(() => void 0) });
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
        setting: DECLINED,
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
      await board.user.selectOptions(settings.getByLabelText("Run time"), "07:00");
      await board.user.click(settings.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(board.sent(CONFIGURE)).toEqual([
          {
            projectId: "project-1",
            board: { kind: "dashboard", id: "board-1", name: "Checkout health" },
            hour: 7,
            timezone: AMSTERDAM,
            maxInsights: 3,
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

    it("offers no Run now to a member who may not ask Langy", async () => {
      const board = openBoard({ setting: ON });

      const dropdown = await openDropdown(board.user);

      expect(dropdown.queryByRole("button", { name: "Run now" })).toBeNull();
    });
  });

  describe("when they choose Run now, with no run in flight", () => {
    /** @scenario "Run now asks for a run and opens Langy on it" */
    it("asks for a run on the board, and opens Langy on its conversation once it started", async () => {
      let hasStarted = false;
      const board = openBoard({
        setting: () => (hasStarted ? RUNNING : ON),
        host: ASKER,
        write: () => Promise.resolve({ requestId: "request-1" }),
      });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(board.sent(RUN_NOW)).toHaveLength(1));
      // The read is asked again once the request is in; it names no run yet, so Langy waits.
      await waitFor(() => expect(board.reads()).toHaveLength(2));
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
    it("reads the board once more, and opens Langy on the run without waiting for its outcome", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let isStored = false;
        const board = openBoard({
          setting: () => (isStored ? RUNNING : ON),
          host: ASKER,
          write: () => Promise.resolve({ requestId: "request-1" }),
        });
        const dropdown = await openDropdown(board.user);
        await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
        await waitFor(() => expect(board.reads()).toHaveLength(2));

        await board.readHint();
        expect(board.reads()).toHaveLength(3);
        isStored = true;
        await vi.advanceTimersByTimeAsync(REQUESTED_RUN_REREAD_MS);

        await waitFor(() =>
          expect(board.host.queries).toEqual([{ langyConversation: "conversation-7" }]),
        );
        await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS);
        expect(board.reads()).toHaveLength(4);
        expect(board.host.failures).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("when a scheduled run settles after they chose Run now, before the board read it", () => {
    /** @scenario "Run now waits for the run it asked for, not one that settled meanwhile" */
    it("keeps waiting, and opens Langy on the run it asked for once that starts", async () => {
      let read = ON;
      const board = openBoard({
        setting: () => read,
        host: ASKER,
        write: () => {
          read = ranToday({ runId: "run-scheduled", conversationId: "conversation-6" });
          return Promise.resolve({ requestId: "request-1" });
        },
      });
      const dropdown = await openDropdown(board.user);

      await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
      await waitFor(() => expect(board.reads()).toHaveLength(2));
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

  describe("when the run they asked for shows neither a start nor an outcome", () => {
    /** @scenario "Run now asks for a run and opens Langy on it" */
    it("follows it for as long as a run can last, then says it could not be started", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const board = openBoard({
          setting: ON,
          host: ASKER,
          write: () => Promise.resolve({ requestId: "request-1" }),
        });
        const dropdown = await openDropdown(board.user);
        await board.user.click(dropdown.getByRole("button", { name: "Run now" }));
        await waitFor(() => expect(board.reads()).toHaveLength(2));

        await vi.advanceTimersByTimeAsync(INSIGHT_DAILY_RUN_EXPIRY_MS - 60_000);
        expect(board.host.failures).toEqual([]);
        // No timer asks the read again while the run is awaited.
        expect(board.reads()).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(60_000);

        await waitFor(() => expect(board.host.failures).toHaveLength(1));
        expect(board.host.failures[0]?.fallbackTitle).toBe("Couldn't start the run");
        const again = await openDropdown(board.user);
        expect(again.getByRole("button", { name: "Run now" })).toBeInTheDocument();
        expect(board.host.queries).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
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
      // The reason is in the dropdown: no offer, and no second switch beside it.
      expect(screen.queryByRole("dialog", { name: OFFER })).toBeNull();
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
      const offer = await screen.findByRole("dialog", { name: OFFER });

      await board.user.click(within(offer).getByRole("button", { name: "Turn on" }));

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

  describe("when a member is offered its daily run", () => {
    /** @scenario "A From LangWatch board says before the answer that no run reads it yet" */
    it("says in the offer that a run on this board files nothing for now", async () => {
      openBoard({ kind: "template", id: "release" });

      const offer = await screen.findByRole("dialog", { name: OFFER });

      expect(
        within(offer).getByText(
          "Langy cannot read From LangWatch boards yet. Until it can, a run on this board files nothing.",
        ),
      ).toBeInTheDocument();
    });

    /** @scenario "A From LangWatch board says before the answer that no run reads it yet" */
    it("says no such thing on a stored board", async () => {
      openBoard();

      const offer = await screen.findByRole("dialog", { name: OFFER });

      expect(within(offer).queryByText(/cannot read From LangWatch boards/)).toBeNull();
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
  ])("shows no control, opens no offer and asks the server nothing when %s", async (_, host) => {
    const board = openBoard({ host });

    // A control that were coming would have asked for its read by now.
    await board.user.click(screen.getByRole("button", { name: "Add a widget" }));

    expect(screen.queryByText("Daily insights")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(board.calls).toEqual([]);
  });
});
