/**
 * The simulated user and the judge of a run with scenario hooks, shown the run's current state on
 * every turn. Thin platform wrappers: the scenario library itself does not change (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";

type RunState = Record<string, unknown>;
type StateReader = () => RunState | null;

/** The input with the state appended as a system note; no state, no note. */
function withStateNote(
  input: ScenarioRunner.AgentInput,
  state: RunState | null,
): ScenarioRunner.AgentInput {
  if (!state) return input;
  const note: ScenarioRunner.AgentInput["messages"][number] = {
    role: "system",
    content: `Current test state: ${JSON.stringify(state)}`,
  };
  return { ...input, messages: [...input.messages, note] };
}

/** The user simulator, reading the state as it stands when its turn starts. */
export class StateAwareUserSimulatorAgent extends ScenarioRunner.UserSimulatorAgentAdapter {
  name: string;
  role = ScenarioRunner.AgentRole.USER;

  constructor(
    private readonly inner: ScenarioRunner.AgentAdapter,
    private readonly readState: StateReader,
  ) {
    super();
    this.name = inner.name ?? "UserSimulatorAgent";
  }

  call(input: ScenarioRunner.AgentInput): ReturnType<ScenarioRunner.AgentAdapter["call"]> {
    return this.inner.call(withStateNote(input, this.readState()));
  }
}

/** The judge, reading the state as it stands when its turn starts; its criteria are the inner's. */
export class StateAwareJudgeAgent extends ScenarioRunner.JudgeAgentAdapter {
  name: string;
  role = ScenarioRunner.AgentRole.JUDGE;
  criteria: string[];

  constructor(
    private readonly inner: ScenarioRunner.JudgeAgentAdapter,
    private readonly readState: StateReader,
  ) {
    super();
    this.name = inner.name ?? "JudgeAgent";
    this.criteria = inner.criteria;
  }

  call(input: ScenarioRunner.AgentInput): ReturnType<ScenarioRunner.AgentAdapter["call"]> {
    return this.inner.call(withStateNote(input, this.readState()));
  }
}

/** Gives the simulated user and the judge of a run with hooks the run's current state. */
export class RunStateRolesService {
  static create({ readState }: { readState: StateReader }): RunStateRolesService {
    return new RunStateRolesService(readState);
  }

  private constructor(private readonly readState: StateReader) {}

  /** The simulated user and the judge, each shown the current state on every turn. */
  wrap({
    userSimulator,
    judge,
  }: {
    userSimulator: ScenarioRunner.AgentAdapter;
    judge: ScenarioRunner.JudgeAgentAdapter;
  }): { userSimulator: StateAwareUserSimulatorAgent; judge: StateAwareJudgeAgent } {
    return {
      userSimulator: new StateAwareUserSimulatorAgent(userSimulator, this.readState),
      judge: new StateAwareJudgeAgent(judge, this.readState),
    };
  }
}
