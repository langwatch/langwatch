/**
 * `agentGreetsFirst` opens the run with the agent's own turn, capturing a
 * phone greeting sent instantly on connect, before the normal simulator loop.
 * @see specs/features/agents/voice-phone.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type { TargetAdapterData } from "@langwatch/scenario-contract";

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
 * The script for a greeting-first target, or `undefined` when it does not
 * apply. A bare `agent()` + `proceed()` skips straight to Judge; scheduling
 * `user()`/`agent()` explicitly guarantees a caller reply before any verdict.
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
