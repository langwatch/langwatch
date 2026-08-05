/**
 * Who talks in a scenario run, and what drives them.
 *
 * Its own module so it can be tested as the function the run actually calls —
 * `scenario-child-process.ts` invokes `main()` at import, so importing that
 * file from a test starts a scenario run.
 *
 * @see specs/scenarios/red-team-scenarios.feature
 */
import * as ScenarioRunner from "@langwatch/scenario";

import type { createModelFromParams } from "./model.factory";
import { type ChildProcessJobData, RED_TEAM_DEFAULT_TURNS } from "./types";

/**
 * Builds the adversarial attacker for a red-team scenario, or null for a
 * standard one.
 *
 * Returns the marathon script alongside the agent. The script is what the
 * runner walks, so it — not `maxTurns` — is what gives the attack its full
 * turn budget, and it is what stops the judge from ending the run at turn one
 * on a scenario where nothing has gone wrong yet.
 */
export function buildRedTeamAgent({
  scenario,
  model,
}: {
  scenario: ChildProcessJobData["scenario"];
  model: ReturnType<typeof createModelFromParams>;
}): {
  agent: ScenarioRunner.UserSimulatorAgentAdapter;
  script: ScenarioRunner.ScriptStep[];
} | null {
  if (!scenario.redTeamStrategy || !scenario.redTeamTarget) return null;

  const totalTurns = scenario.redTeamTotalTurns ?? RED_TEAM_DEFAULT_TURNS;
  // Stored config first, so the three fields this function owns cannot be
  // overwritten by it. The other order happened to be safe only because
  // `RedTeamConfigSchema` is a stripping `z.object` on every write path today
  // — a cross-file invariant nothing states and nothing checks. Precedence
  // belongs where you can see it.
  const config = {
    ...(scenario.redTeamConfig ?? {}),
    target: scenario.redTeamTarget,
    totalTurns,
    model,
  };

  const agent =
    scenario.redTeamStrategy === "goat"
      ? ScenarioRunner.redTeamGoat(config)
      : ScenarioRunner.redTeamCrescendo(config);

  return { agent, script: agent.marathonScript() };
}

/**
 * Who talks, and — for a red-team run — in what order.
 *
 * A red-team attacker IS a user simulator (it extends the same adapter), so it
 * drops straight into the simulator slot and everything downstream — the judge,
 * the criteria, the reporting — stays exactly as it is.
 *
 * marathonScript is what makes a red-team run a real one. Without it the judge
 * runs every turn and can end the scenario the moment nothing has gone wrong —
 * "must never reveal X" is satisfied by one clean exchange, so a 50-turn attack
 * finishes at turn one reporting that the agent held.
 *
 * The script is also the turn control. It expands to totalTurns rounds and the
 * runner walks it step by step, so maxTurns is not consulted on this path at
 * all (verified in the SDK: the scripted branch loops over script.length; the
 * maxTurns check lives in the auto-advance branch). Setting it here would be
 * dead config that reads like a safeguard.
 */
export function buildConversation({
  adapter,
  scenario,
  simulatorModel,
  judgeAgent,
}: {
  adapter: ScenarioRunner.AgentAdapter;
  scenario: ChildProcessJobData["scenario"];
  simulatorModel: ReturnType<typeof createModelFromParams>;
  judgeAgent: ScenarioRunner.JudgeAgentAdapter;
}): {
  agents: ScenarioRunner.AgentAdapter[];
  script: { script?: ScenarioRunner.ScriptStep[] };
} {
  const redTeam = buildRedTeamAgent({ scenario, model: simulatorModel });
  const simulator =
    redTeam?.agent ??
    ScenarioRunner.userSimulatorAgent({ model: simulatorModel });
  return {
    agents: [adapter, simulator, judgeAgent],
    script: redTeam ? { script: redTeam.script } : {},
  };
}
