/**
 * What a scenario or a suite run points at.
 *
 * The picker calls it a `TargetValue` because that is the prop it holds; every
 * other reader calls it a `ScenarioTarget`. Both names are here so the run
 * dialog, the store, the compare rows and the filters can agree on the shape
 * without any of them reaching into the picker that draws it.
 */
export type ScenarioTarget = {
  type: "prompt" | "http" | "code" | "workflow" | "connected";
  id: string;
} | null;

/** The picker's own name for a {@link ScenarioTarget}. */
export type TargetValue = ScenarioTarget;
