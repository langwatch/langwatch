import {
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationProcessingEvent,
} from "@langwatch/scenario-contract";

const SIMULATION_RUN_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  Object.values(SIMULATION_RUN_EVENT_TYPES),
);

/** An event the simulation_run aggregate declared, by its type; the log already validated it. */
export function isSimulationProcessingEvent(event: unknown): event is SimulationProcessingEvent {
  if (typeof event !== "object" || event === null || !("type" in event)) return false;
  return typeof event.type === "string" && SIMULATION_RUN_EVENT_TYPE_SET.has(event.type);
}
