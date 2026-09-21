/**
 * The scripted conversation of an agent test run, as the child plays it.
 * @see specs/agents/agent-test-run.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type { ScriptedRun } from "@langwatch/scenario-contract";

/**
 * Fills the user role of a scripted run. The runner requires an agent of that role before it
 * accepts a user message, even one with its text given, and this one refuses to improvise so a
 * script that runs out of lines fails rather than invents a person.
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

export class AgentTestScriptAdapter {
  static create(): AgentTestScriptAdapter {
    return new AgentTestScriptAdapter();
  }

  /**
   * The agents and steps of an agent test run: user says the message, agent
   * answers, run succeeds. When the target greets on connect (an inbound
   * `callDirection`), it opens with the agent's turn first instead.
   */
  build({
    adapter,
    script,
    doesAgentGreetFirst = false,
  }: {
    adapter: ScenarioRunner.AgentAdapter;
    script: ScriptedRun;
    doesAgentGreetFirst?: boolean;
  }): {
    agents: ScenarioRunner.AgentAdapter[];
    script: ScenarioRunner.ScriptStep[];
  } {
    return {
      agents: [adapter, new ScriptedUserAgent()],
      script: [
        ...(doesAgentGreetFirst ? [ScenarioRunner.agent()] : []),
        ScenarioRunner.user(script.userMessage),
        ScenarioRunner.agent(),
        ScenarioRunner.succeed("The agent answered"),
      ],
    };
  }
}
