/**
 * The simulated user and the judge of a run with hooks read the run's current state each turn,
 * and the hooks default to a 60 second budget (ADR-180).
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { RunStateRolesService } from "../services/run-state-roles.service.ts";
import {
  type ScenarioHookCaller,
  ScenarioRunHooksService,
} from "../services/scenario-run-hooks.service.ts";

/** A role that remembers the messages it was given on each call. */
class RecordingUser extends ScenarioRunner.UserSimulatorAgentAdapter {
  name = "RecordingUser";
  role = ScenarioRunner.AgentRole.USER;
  readonly seen: ScenarioRunner.AgentInput["messages"][] = [];

  async call(input: ScenarioRunner.AgentInput) {
    this.seen.push(input.messages);
    return "next question";
  }
}

class RecordingJudge extends ScenarioRunner.JudgeAgentAdapter {
  name = "RecordingJudge";
  role = ScenarioRunner.AgentRole.JUDGE;
  criteria = ["Refunds the order"];
  readonly seen: ScenarioRunner.AgentInput["messages"][] = [];

  async call(input: ScenarioRunner.AgentInput) {
    this.seen.push(input.messages);
    return null;
  }
}

function turnInput(): ScenarioRunner.AgentInput {
  return {
    threadId: "thread_1",
    messages: [{ role: "user", content: "refund order 42" }],
    newMessages: [],
    requestedRole: ScenarioRunner.AgentRole.USER,
    scenarioState: {} as never,
    scenarioConfig: {} as never,
  };
}

const lastContent = (messages: ScenarioRunner.AgentInput["messages"] | undefined) =>
  messages?.at(-1)?.content;

describe("RunStateRolesService", () => {
  describe("when the run's state changes between turns", () => {
    /** @scenario "The simulated user and the judge see the current state each turn" */
    it("shows both roles the state as it stands on each turn", async () => {
      let state: Record<string, unknown> | null = { orderId: "42" };
      const user = new RecordingUser();
      const judge = new RecordingJudge();
      const roles = RunStateRolesService.create({ readState: () => state }).wrap({
        userSimulator: user,
        judge,
      });

      await roles.userSimulator.call(turnInput());
      await roles.judge.call(turnInput());
      state = { orderId: "43" };
      await roles.userSimulator.call(turnInput());
      await roles.judge.call(turnInput());

      expect(lastContent(user.seen[0])).toBe('Current test state: {"orderId":"42"}');
      expect(lastContent(judge.seen[0])).toBe('Current test state: {"orderId":"42"}');
      expect(lastContent(user.seen[1])).toBe('Current test state: {"orderId":"43"}');
      expect(lastContent(judge.seen[1])).toBe('Current test state: {"orderId":"43"}');
    });

    it("keeps the judge's role and criteria, so the runner still finds its judge", () => {
      const roles = RunStateRolesService.create({ readState: () => null }).wrap({
        userSimulator: new RecordingUser(),
        judge: new RecordingJudge(),
      });

      expect(roles.judge).toBeInstanceOf(ScenarioRunner.JudgeAgentAdapter);
      expect(roles.judge.criteria).toEqual(["Refunds the order"]);
      expect(roles.userSimulator.role).toBe(ScenarioRunner.AgentRole.USER);
    });
  });

  describe("when the run has no state yet", () => {
    it("adds no note", async () => {
      const user = new RecordingUser();
      const roles = RunStateRolesService.create({ readState: () => null }).wrap({
        userSimulator: user,
        judge: new RecordingJudge(),
      });

      await roles.userSimulator.call(turnInput());

      expect(user.seen[0]).toEqual(turnInput().messages);
    });
  });
});

describe("ScenarioRunHooksService", () => {
  describe("when the scenario sets no hook timeout", () => {
    /** @scenario "Each hook defaults to 60 seconds" */
    it("gives setup and teardown 60 seconds each", async () => {
      const budgets: number[] = [];
      const caller = createApiFixture<ScenarioHookCaller>({
        runState: null,
        callHook: async ({ timeoutMs }) => {
          budgets.push(timeoutMs);
          return { state: { orderId: "42" } };
        },
      });

      await ScenarioRunHooksService.create({
        caller,
        declared: { setup: true, teardown: true },
      }).around(async () => ({ success: true }));

      expect(budgets).toEqual([60_000, 60_000]);
    });
  });
});
