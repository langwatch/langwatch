/**
 * `isAgentSpeaksFirst` opens the run with the agent's own turn, capturing a
 * phone greeting sent instantly on connect, before the normal simulator loop.
 * @see specs/features/agents/voice-phone.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type { TargetAdapterData } from "@langwatch/scenario-contract";

/**
 * Phone agents may greet the instant the call connects, so the run must
 * capture that greeting before the user simulator speaks.
 */
export function isAgentSpeaksFirst(adapterData: TargetAdapterData): boolean {
  return (
    adapterData.type === "voice" &&
    adapterData.voiceTarget.transport === "phone" &&
    adapterData.voiceTarget.isAgentSpeaksFirst
  );
}

/**
 * The script that makes the agent under test greet first, or `undefined` when
 * the target does not ask for it (every other run keeps its default cast, which
 * opens with the user simulator).
 */
export function buildIsAgentSpeaksFirstScript(
  adapterData: TargetAdapterData,
): ScenarioRunner.ScriptStep[] | undefined {
  return isAgentSpeaksFirst(adapterData)
    ? [ScenarioRunner.agent(), ScenarioRunner.proceed()]
    : undefined;
}
