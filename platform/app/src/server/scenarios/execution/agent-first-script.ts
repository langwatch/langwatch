/**
 * The "Agent speaks first" script for a non-scripted phone voice run.
 *
 * Some phone agents greet the moment the call connects (scenario#995,
 * scenario#992). A normal run opens with the user simulator, so the caller
 * talks over — or before — that greeting and the callee asks "is anyone
 * there?". When the target has `agentSpeaksFirst` on, the run instead opens
 * with the agent's own turn (so the greeting is captured as the first turn),
 * then hands over to the normal simulator/judge loop via `proceed()`, which
 * runs the scenario to its conclusion.
 *
 * Lives in its own module because the child entry point runs `main()` at import
 * time; this keeps the decision unit-testable without that side effect.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type { TargetAdapterData } from "./types";

/** Whether this target is a phone voice target that greets on connect. */
export function isAgentSpeaksFirst(adapterData: TargetAdapterData): boolean {
  return (
    adapterData.type === "voice" &&
    adapterData.voiceTarget.transport === "phone" &&
    adapterData.voiceTarget.agentSpeaksFirst
  );
}

/**
 * The script that makes the agent under test greet first, or `undefined` when
 * the target does not ask for it (every other run keeps its default cast, which
 * opens with the user simulator).
 */
export function buildAgentSpeaksFirstScript(
  adapterData: TargetAdapterData,
): ScenarioRunner.ScriptStep[] | undefined {
  return isAgentSpeaksFirst(adapterData)
    ? [ScenarioRunner.agent(), ScenarioRunner.proceed()]
    : undefined;
}
