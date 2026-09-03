/**
 * The scripted conversation of an agent test run, as the child plays it.
 *
 * The user's one message is written down, the agent under test answers it,
 * and the run is marked successful the moment the answer is in. No model is
 * built: the user role is filled by an agent that is never asked to speak,
 * because every user turn already has its text, and no judge is on the list
 * because the script decides the verdict itself.
 *
 * @see specs/agents/agent-test-run.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type { ScriptedRun } from "@langwatch/scenario-contract";

/**
 * Fills the user role of a scripted run. The runner requires an agent of
 * that role before it accepts a user message, even one with its text given,
 * and this one refuses to improvise so a script that runs out of lines fails
 * rather than invents a person.
 */
export class ScriptedUserAgent extends ScenarioRunner.UserSimulatorAgentAdapter {
  name = "ScriptedUserAgent";
  role = ScenarioRunner.AgentRole.USER;

  call(): Promise<string> {
    return Promise.reject(
      new Error(
        "The scripted user has no more lines; every user turn of an agent test is written down",
      ),
    );
  }
}

/**
 * The agents and the steps of an agent test run: the user says the message,
 * the agent under test answers, the run succeeds.
 */
export function buildAgentTestRun({
  adapter,
  script,
}: {
  adapter: ScenarioRunner.AgentAdapter;
  script: ScriptedRun;
}): {
  agents: ScenarioRunner.AgentAdapter[];
  script: ScenarioRunner.ScriptStep[];
} {
  return {
    agents: [adapter, new ScriptedUserAgent()],
    script: [
      ScenarioRunner.user(script.userMessage),
      ScenarioRunner.agent(),
      ScenarioRunner.succeed("The agent answered"),
    ],
  };
}
