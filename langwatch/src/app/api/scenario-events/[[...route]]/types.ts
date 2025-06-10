import { z } from "zod";
import {
  scenarioRunStartedSchema,
  scenarioRunFinishedSchema,
  scenarioMessageSnapshotSchema,
  scenarioEventSchema,
  scenarioBatchSchema,
  runDataSchema,
} from "./schemas";

// Type exports
export type ScenarioRunStartedEvent = z.infer<typeof scenarioRunStartedSchema>;
export type ScenarioRunFinishedEvent = z.infer<
  typeof scenarioRunFinishedSchema
>;
export type ScenarioMessageSnapshotEvent = z.infer<
  typeof scenarioMessageSnapshotSchema
>;
export type ScenarioEvent = z.infer<typeof scenarioEventSchema>;
export type ScenarioBatch = z.infer<typeof scenarioBatchSchema>;
export type ScenarioRunData = z.infer<typeof runDataSchema>;

export type ScenarioSetData = {
  scenarioSetId: string;
  scenarioCount: number;
  lastRunAt: number;
};
