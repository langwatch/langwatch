// Which board a chart lands on: the board the user is on, unless they ask for a new one.
// Driven through the real product surface (langy-agent.ts), with the board chip a real
// composer attaches. @see specs/langy/langy-context-system.feature

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import { createBoard, listBoards, listBoardWidgets } from "./langwatch-api";
import { makeLangyAdapter, type PageContextChip } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";

// Chat completions, so a gateway virtual key and any provider behind it can run the judge.
const model = openai.chat(process.env.LANGY_SCENARIO_MODEL ?? "gpt-5-mini");

/** The chip the board screen attaches: name, id and period, as boardContextChip writes it. */
function boardChip({ id, name }: { id: string; name: string }): PageContextChip {
  return {
    kind: "dashboard",
    label: `dashboard: ${name} · 30d · 1d`,
    ref: `dashboard ${JSON.stringify(name)} (id ${id}); widgets: none yet; period: the last 30 days, one bucket per 1 day`,
  };
}

describe("Langy picks the board a chart goes on", () => {
  /** @scenario "A chart asked for on a board lands on that board" */
  it("puts a chart asked for on a board on that board, or asks, never a silent new board", async () => {
    const name = `langy-board-usage-${Date.now()}`;
    const board = await createBoard({ name });
    const boardsBefore = new Set((await listBoards()).map(({ id }) => id));
    const langy = makeLangyAdapter({ pageContext: [boardChip({ id: board.id, name })] });

    const result = await runScenarioAndLog({
      config: {
        name: "chart on the board on screen",
        description: `The user is looking at their dashboard "${name}" and asks for one more chart.`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [
              `Langy either added the chart to the dashboard "${name}" or asked which board to put it on.`,
              "Langy did not make a new dashboard.",
            ],
          }),
        ],
        script: [
          scenario.user(
            "ok now another dashboard, I want a weekly burndown chart of how many tokens we use, from saturday to the next",
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      },
    });
    if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
    expect(result.success).toBe(true);

    const madeBoards = (await listBoards()).filter(({ id }) => !boardsBefore.has(id));
    expect(madeBoards).toEqual([]);
    const widgets = await listBoardWidgets({ dashboardId: board.id });
    console.log(`Widgets on "${name}": ${widgets.length}`);
  });

  /** @scenario "Asking for a new dashboard makes one" */
  it("makes a board when the user asks for a new one by name", async () => {
    const name = `langy-weekly-usage-${Date.now()}`;
    const onScreen = await createBoard({ name: `langy-board-current-${Date.now()}` });
    const langy = makeLangyAdapter({
      pageContext: [boardChip({ id: onScreen.id, name: "Current board" })],
    });

    const result = await runScenarioAndLog({
      config: {
        name: "a new board on request",
        description: `The user wants a new, separate dashboard called "${name}".`,
        agents: [
          langy,
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            criteria: [`Langy reports making a new dashboard named "${name}".`],
          }),
        ],
        script: [
          scenario.user(`create a new dashboard called "${name}"`),
          scenario.agent(),
          scenario.judge(),
        ],
      },
    });
    if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
    expect(result.success).toBe(true);

    expect((await listBoards()).map((listed) => listed.name)).toContain(name);
  });
});
