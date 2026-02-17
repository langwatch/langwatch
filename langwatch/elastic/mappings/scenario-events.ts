/**
 * Scenario Event Mappings for Elasticsearch
 * Maps the schema defined in schemas.ts to Elasticsearch field types
 */

import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";
import type {
  ScenarioEvent,
  ScenarioMessageSnapshotEvent,
  ScenarioRunFinishedEvent,
  ScenarioRunStartedEvent,
} from "~/server/scenarios/scenario-event.types";
import { FLATENNED_TYPE } from "~/server/elasticsearch";
import type { ElasticSearchMappingFrom } from "../schema";

type BaseScenarioEventMapping = Pick<
  ScenarioEvent,
  | "type"
  | "timestamp"
  | "rawEvent"
  | "scenarioId"
  | "scenarioRunId"
  | "batchRunId"
  | "scenarioSetId"
> & {
  projectId: string;
};

// Utility class to remove base event mapping from an event type
type RemoveBaseEventMapping<T> = Omit<T, keyof BaseScenarioEventMapping>;

// Base event mapping (common to all events)
const baseScenarioEventMapping: ElasticSearchMappingFrom<BaseScenarioEventMapping> =
  {
    type: { type: "keyword" },
    timestamp: { type: "date" },
    raw_event: { type: FLATENNED_TYPE as any }, // Added from base schema
    project_id: { type: "keyword" },
    scenario_id: { type: "keyword" },
    scenario_run_id: { type: "keyword" },
    batch_run_id: { type: "keyword" },
    scenario_set_id: { type: "keyword" }, // Added from base scenario event schema
  };

// Scenario Run Started Event mapping
const runStartedMapping: ElasticSearchMappingFrom<
  RemoveBaseEventMapping<ScenarioRunStartedEvent>
> = {
  metadata: {
    properties: {
      name: { type: "text", fields: { keyword: { type: "keyword" } } },
      description: { type: "text" },
    },
  },
};

const runFinishedMapping: ElasticSearchMappingFrom<
  RemoveBaseEventMapping<ScenarioRunFinishedEvent>
> = {
  status: { type: "keyword" },
  results: {
    properties: {
      verdict: { type: "keyword" },
      reasoning: { type: "text" },
      met_criteria: { type: "keyword" },
      unmet_criteria: { type: "keyword" },
      error: { type: "text" },
    },
  },
};

// Scenario Message Snapshot Event mapping
const messageSnapshotMapping: ElasticSearchMappingFrom<
  RemoveBaseEventMapping<ScenarioMessageSnapshotEvent>
> = {
  messages: {
    properties: {
      id: { type: "keyword" },
      role: { type: "keyword" },
      content: { type: "text" }, // maybe we need to json stringify when content is a json
      tool_call_id: { type: "keyword" },
      name: { type: "text" },
      trace_id: { type: "keyword" },
    },
  },
};

// Combine all mappings
export const eventMapping = {
  properties: {
    ...baseScenarioEventMapping,
    ...runStartedMapping,
    ...runFinishedMapping,
    ...messageSnapshotMapping,
  } as ElasticSearchMappingFrom<ScenarioEvent>,
};
