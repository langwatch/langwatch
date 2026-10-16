/**
 * How a run's setup and teardown read on its detail view (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import {
  isRunNotScored,
  type ScenarioHookResult,
  type SimulationRunMetadata,
  type SimulationRunStatus as ScenarioRunStatus,
} from "@langwatch/scenario-contract";

import { isFinishedRunStatus } from "./scenario-run-status.utils.ts";

export type HookTone = "ok" | "warn" | "danger" | "muted";

/** The one tag a run's hooks earn in its header. The verdict stays the conversation's. */
export interface RunHooksTag {
  text:
    | "Setup failed"
    | "Setup timed out"
    | "Teardown failed"
    | "Teardown not run"
    | "Teardown skipped";
  tone: HookTone;
}

/** What the run detail draws for its hooks. */
export interface RunHooksView {
  setup: ScenarioHookResult | null;
  teardown: ScenarioHookResult | null;
  /** A finished run on an agent that declared no hooks. */
  noHooks: boolean;
  notScored: boolean;
  tag: RunHooksTag | null;
}

function tagOf({
  setup,
  teardown,
}: {
  setup: ScenarioHookResult | null;
  teardown: ScenarioHookResult | null;
}): RunHooksTag | null {
  if (setup?.status === "timed_out") return { text: "Setup timed out", tone: "warn" };
  if (setup && setup.status !== "ok") return { text: "Setup failed", tone: "danger" };
  // A teardown that timed out keeps `timed_out` in the record but reads as failed.
  if (teardown?.status === "failed" || teardown?.status === "timed_out") {
    return { text: "Teardown failed", tone: "danger" };
  }
  if (teardown?.status === "not_run") return { text: "Teardown not run", tone: "warn" };
  if (teardown?.status === "skipped") return { text: "Teardown skipped", tone: "muted" };
  return null;
}

/** Reads the hooks off a run's metadata; a prompt target never has hooks to speak of. */
export function runHooksViewOf({
  metadata,
  status,
}: {
  metadata: SimulationRunMetadata | undefined;
  status: ScenarioRunStatus | undefined;
}): RunHooksView {
  const reserved = metadata?.langwatch;
  const hooks = reserved?.hooks;
  const setup = hooks?.setup ?? null;
  const teardown = hooks?.teardown ?? null;
  const isAgentTarget = reserved !== undefined && reserved.targetType !== "prompt";
  return {
    setup,
    teardown,
    noHooks: !setup && !teardown && isAgentTarget && isFinishedRunStatus(status),
    notScored: isRunNotScored(hooks),
    tag: tagOf({ setup, teardown }),
  };
}

/** A hook's duration as the band's title line shows it. */
export function formatHookDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/** One state value as a line of text: strings as they are, anything else as JSON. */
export function formatStateValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
