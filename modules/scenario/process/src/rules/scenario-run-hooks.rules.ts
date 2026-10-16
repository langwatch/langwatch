/**
 * Which runs call scenario hooks, and how their results are kept on the run (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { STATE_MAX_BYTES } from "@langwatch/agent-contract";
import type {
  ScenarioHookResult,
  ScenarioRunHooks,
  TargetAdapterData,
} from "@langwatch/scenario-contract";

/** Whether a run against this target calls a setup or a teardown hook. */
export function adapterDeclaresHooks(adapterData: TargetAdapterData): boolean {
  if (adapterData.type !== "connected") return false;
  return Boolean(adapterData.hooks?.setup || adapterData.hooks?.teardown);
}

function isOverCap(value: unknown): boolean {
  return Buffer.byteLength(JSON.stringify(value), "utf8") > STATE_MAX_BYTES;
}

/** One hook result with a value over the cap dropped whole and marked, never cut. */
function capHookResult(result: ScenarioHookResult): ScenarioHookResult {
  const { state, returned, ...rest } = result;
  const kept: ScenarioHookResult = { ...rest };
  if (state !== undefined) {
    if (isOverCap(state)) kept.stateTooLarge = true;
    else kept.state = state;
  }
  if (returned !== undefined) {
    if (isOverCap(returned)) kept.returnedTooLarge = true;
    else kept.returned = returned;
  }
  return kept;
}

/** The run's hook results as the run record may keep them. */
export function capRunHooks(hooks: ScenarioRunHooks): ScenarioRunHooks {
  return {
    ...(hooks.setup ? { setup: capHookResult(hooks.setup) } : {}),
    ...(hooks.teardown ? { teardown: capHookResult(hooks.teardown) } : {}),
  };
}

/** Whether a child's result line carried any hook result worth recording. */
export function hasHookResults(hooks: ScenarioRunHooks | undefined): hooks is ScenarioRunHooks {
  return Boolean(hooks?.setup || hooks?.teardown);
}
