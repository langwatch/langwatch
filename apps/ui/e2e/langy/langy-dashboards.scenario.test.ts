/**
 * Dashboards scenario D1 (issue 8573): a chart added to the board the user
 * attached, and to no other. README.md "Dashboards and Insights" covers the
 * world, the "world state" span and where results are reported.
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";

import { diffBoards } from "./board-state";
import { createCostMeter } from "./cost-meter";
import {
  readWorld,
  reportWorldStateEachTurn,
  setupWorld,
  type World,
  type WorldParams,
} from "./dashboards-world";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";

const SET_ID = "langy-dashboards-insights";

const meter = createCostMeter();
const model = meter.wrap(openai("gpt-5-mini"), "judge");

const params: WorldParams = {
  role: "admin",
  tracesPerDay: 24,
  days: 2,
  board: "Checkout health",
  decoy: "Weekly review",
};
const seededTotal = params.tracesPerDay * params.days;

let world: World;

describe("Langy builds a dashboard chart on the board the user attached", () => {
  beforeAll(async () => {
    world = await setupWorld({ label: "D1", params });
    meter.watchLangy({ organizationId: world.project.organizationId });
  }, 300_000);

  it("adds one trace volume chart to the attached board and leaves the decoy alone", async () => {
    const langy = reportWorldStateEachTurn({
      adapter: makeLangyAdapter({
        pageContext: [{ kind: "dashboard", ref: world.board.id, label: params.board }],
      }),
      world,
    });

    const result = await runScenarioAndLog({
      cost: meter,
      label: "D1 trace volume chart",
      path: new URL(world.board.platformUrl).pathname,
      config: {
        name: "D1: chart on the attached board",
        setId: SET_ID,
        description: `As an ${params.role} of the project, I am looking at the "${params.board}" dashboard and attached it to the chat. The project also has a "${params.decoy}" dashboard, the decoy, holding ${world.initial.decoy.items.length} widget of its own. The project received ${params.tracesPerDay} traces on each of the last ${params.days} days. I ask for a chart of trace volume per day over those full days.`,
        agents: [
          langy,
          // The script sends the user's one message, so the simulator is never asked to write one.
          scenario.userSimulatorAgent({ model }),
          scenario.judgeAgent({
            model,
            // Langy's tool output makes the trace large; under the default threshold the judge
            // sees span names alone and never reads the "world state" facts.
            tokenThreshold: 60_000,
            criteria: [
              `Adds one chart of trace volume to the "${params.board}" dashboard and to no other dashboard`,
              `The chart counts ${seededTotal} traces in total over the ${params.days} days`,
              `The chart shows one value per day, ${params.days} values in all, not a single total`,
              `The "${params.decoy}" dashboard still holds exactly its ${world.initial.decoy.items.length} widget: nothing added to it or removed from it`,
              "Does not ask which dashboard to use, since the attached dashboard names it",
            ],
          }),
        ],
        script: [
          scenario.user(
            `Add a chart of trace volume per day for the last ${params.days} full days (UTC) to this dashboard.`,
          ),
          scenario.agent(),
          scenario.judge(),
        ],
      },
    });

    const after = await readWorld(world);
    console.log("[world] final facts:", JSON.stringify(after.facts));
    const board = diffBoards({ before: world.initial.board, after: after.board });
    const decoy = diffBoards({ before: world.initial.decoy, after: after.decoy });
    expect(board.added).toHaveLength(1);
    expect(board.removed).toHaveLength(0);
    expect(board.changed).toHaveLength(0);
    expect(after.facts.project_widget_count).toBe(world.initial.projectItems + 1);
    expect(after.facts.chart_total).toBe(seededTotal);
    expect(after.facts.chart_days).toBe(params.days);
    expect(decoy.added).toHaveLength(0);
    expect(decoy.removed).toHaveLength(0);
    expect(decoy.changed).toHaveLength(0);

    if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
    expect(result.success).toBe(true);
  }, 1_200_000);
});
