import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

// Types for props
export type RunItem = {
  status: ScenarioRunStatus;
  title: string;
  description: string;
  batchRunId: string;
  scenarioRunId: string;
};

export type Run = {
  batchRunId: string;
  scenarioRunId: string;
  label: string;
  timestamp: number;
  duration: string;
  items: RunItem[];
};
