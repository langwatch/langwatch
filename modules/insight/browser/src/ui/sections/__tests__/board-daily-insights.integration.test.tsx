/**
 * @vitest-environment jsdom
 * "Daily insights" in a board's header over the real tRPC hooks: the three states,
 * what each write sends and what the control says about the last run.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import {
  INSIGHT_RUN_SKIP_REASONS,
  type InsightDailyRunSetting,
  type InsightEntry,
} from "@langwatch/insight-contract";
import { currentTimeZone, format, nowInstant } from "@langwatch/time";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

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

const NOTHING_YET = { settings: null, lastRun: null, offReason: null };
const UNDECIDED: InsightDailyRunSetting = { state: "undecided", ...NOTHING_YET };
const OFF_WITHOUT_CHOICES: InsightDailyRunSetting = { state: "off", ...NOTHING_YET };
const ON: InsightDailyRunSetting = {
  state: "on",
  settings: { hour: 9, timezone: AMSTERDAM, maxInsights: 3 },
  lastRun: null,
  offReason: null,
};

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
  setting?: InsightDailyRunSetting;
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
  const { host } = renderWithInsightHost({
    element: <Board widgets={widgets} {...board} />,
    host: new StubInsightHost(options),
    answer: (call) => {
      calls.push(call);
      if (call.path === READ) return Promise.resolve(setting);
      if (call.path === "insights.getAll") return Promise.resolve(entries);
      if (call.path === CONFIGURE || call.path === TURN_OFF) return write(call);
      return Promise.reject(new Error(`No test answer for ${call.path}`));
    },
  });
  const sent = (path: string) => calls.filter((call) => call.path === path).map((c) => c.input);
  return {
    host,
    calls,
    reads: () => sent(READ),
    writes: () => [...sent(CONFIGURE), ...sent(TURN_OFF)],
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
