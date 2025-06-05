import { EventType, MessagesSnapshotEventSchema } from "@ag-ui/core";
import { z } from "zod";
import { ScenarioEventType, ScenarioRunStatus, Verdict } from "./enums";
import {
  scenarioRunStartedSchema,
  scenarioRunFinishedSchema,
  scenarioMessageSnapshotSchema,
  scenarioEventSchema,
  scenarioBatchSchema,
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
