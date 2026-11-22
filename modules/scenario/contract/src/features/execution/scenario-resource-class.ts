import type { ScenarioExecutionJob } from "./scenario-execution.service.ts";

/**
 * What a run costs the host that executes it, in slots. Both classes weigh 1, which keeps the
 * pool's limit a plain run count; a heavier class is a new weight here.
 */
export const SCENARIO_RESOURCE_CLASSES = {
  light: { weight: 1 },
  voice: { weight: 1 },
} as const;

export type ScenarioResourceClass = keyof typeof SCENARIO_RESOURCE_CLASSES;

export function isScenarioResourceClass(name: string): name is ScenarioResourceClass {
  return name in SCENARIO_RESOURCE_CLASSES;
}

type ScenarioTargetType = ScenarioExecutionJob["target"]["type"];

/** The resource class each runtime declares; the child's runtime table and the pool read it. */
export const TARGET_RESOURCE_CLASS = {
  prompt: "light",
  http: "light",
  code: "light",
  workflow: "light",
  connected: "light",
  voice: "voice",
} as const satisfies Record<ScenarioTargetType, ScenarioResourceClass>;

export type ScenarioStopSignal = "SIGTERM" | "SIGINT" | "SIGKILL";

/** How each runtime's child is stopped on cancel or drain; each declares today's SIGTERM. */
export const TARGET_STOP_SIGNAL = {
  prompt: "SIGTERM",
  http: "SIGTERM",
  code: "SIGTERM",
  workflow: "SIGTERM",
  connected: "SIGTERM",
  voice: "SIGTERM",
} as const satisfies Record<ScenarioTargetType, ScenarioStopSignal>;
