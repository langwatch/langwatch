/**
 * The greeting-first script for a non-scripted inbound phone voice run.
 *
 * An inbound phone agent answers the call and greets the moment it connects
 * (scenario#995, scenario#992). A normal run opens with the user simulator, so
 * the caller talks over — or before — that greeting and the callee asks "is
 * anyone there?". When the target's `callDirection` is "inbound", the run
 * instead opens with the agent's own turn (so the greeting is captured as the
 * first turn), then hands over to the normal simulator/judge loop via
 * `proceed()`, which runs the scenario to its conclusion.
 *
 * Lives in its own module because the child entry point runs `main()` at import
 * time; this keeps the decision unit-testable without that side effect.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type { TargetAdapterData } from "./types";

/**
 * An inbound phone agent answers and greets the instant the call connects, so
 * the run must capture that greeting before the user simulator speaks.
 */
export function agentGreetsFirst(adapterData: TargetAdapterData): boolean {
  return (
    adapterData.type === "voice" &&
    adapterData.voiceTarget.transport === "phone" &&
    adapterData.voiceTarget.callDirection === "inbound"
  );
}

/**
 * The script that makes the agent under test greet first, or `undefined` when
 * the target does not ask for it (every other run keeps its default cast, which
 * opens with the user simulator).
 *
 * `agent()` alone is not safe to hand off to a bare `proceed()`. The runtime's
 * per-turn role queue starts as [User, Agent, Judge]; `agent()` drains User
 * off the front to reach Agent, but never removes Agent itself from that
 * queue once it has run. A following `proceed()` then finds Agent already
 * spent for the turn, drops it, and lands straight on Judge — so the judge
 * can render (and even close out) the run on the greeting alone, before the
 * caller has said a word. Scheduling the caller's reply and the agent's real
 * response explicitly (`user()`, `agent()`) closes that gap: the judge is
 * only ever reached after both have run.
 *
 * The greeting and the caller's opening reply both happen inside the run's
 * first turn (turn 0), which the runtime never asks the judge about — so
 * this costs the run one judged turn it would otherwise have had. The caller
 * (scenario-child-process.ts) compensates by giving an agent-first run one
 * extra turn of budget.
 */
export function buildAgentGreetsFirstScript(
  adapterData: TargetAdapterData,
): ScenarioRunner.ScriptStep[] | undefined {
  return agentGreetsFirst(adapterData)
    ? [
        ScenarioRunner.agent(),
        ScenarioRunner.user(),
        ScenarioRunner.agent(),
        ScenarioRunner.proceed(),
      ]
    : undefined;
}
