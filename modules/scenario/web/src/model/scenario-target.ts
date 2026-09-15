/**
 * What a scenario or a suite run points at. The picker calls it
 * `TargetValue`, its own prop name; every other reader calls it
 * `ScenarioTarget` — both names exist so nothing reaches into the picker.
 */
export type ScenarioTarget = {
  type: "prompt" | "http" | "code" | "workflow" | "connected" | "voice";
  id: string;
} | null;

/** The picker's own name for a {@link ScenarioTarget}. */
export type TargetValue = ScenarioTarget;
