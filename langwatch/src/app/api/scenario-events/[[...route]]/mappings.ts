/**
 * Scenario Event Mappings for Elasticsearch
 * Maps the schema defined in schemas.ts to Elasticsearch field types
 */

import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";

// Base event mapping (common to all events)
const baseScenarioEventMapping = {
  type: { type: "keyword" },
  timestamp: { type: "date" },
  projectId: { type: "keyword" },
  scenarioId: { type: "keyword" },
  scenarioRunId: { type: "keyword" },
  batchRunId: { type: "keyword" },
};

// Scenario Run Started Event mapping
const runStartedMapping = {
  // No additional fields beyond base mapping
};

// Scenario Run Finished Event mapping
const runFinishedMapping = {
  status: { type: "keyword" },
};

// Scenario Message Snapshot Event mapping
const messageSnapshotMapping = {
  messages: {
    type: "nested",
    properties: {
      id: { type: "keyword" },
      role: { type: "keyword" },
      content: { type: "text" },
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
  } as Record<string, MappingProperty>,
};
