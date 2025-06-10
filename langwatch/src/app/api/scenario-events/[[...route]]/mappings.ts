/**
 * Scenario Event Mappings for Elasticsearch
 * Maps the schema defined in schemas.ts to Elasticsearch field types
 */

import type { MappingProperty } from "@elastic/elasticsearch/lib/api/types";

// Base event mapping (common to all events)
const baseScenarioEventMapping = {
  type: { type: "keyword" },
  timestamp: { type: "date" },
  rawEvent: { type: "object" }, // Added from base schema
  projectId: { type: "keyword" },
  scenarioId: { type: "keyword" },
  scenarioRunId: { type: "keyword" },
  batchRunId: { type: "keyword" },
  scenarioSetId: { type: "keyword" }, // Added from base scenario event schema
};

// Scenario Run Started Event mapping
const runStartedMapping = {
  metadata: {
    type: "object",
    properties: {
      name: { type: "text" },
      description: { type: "text" },
    },
  },
};

// Scenario Run Finished Event mapping
const runFinishedMapping = {
  status: { type: "keyword" },
  results: {
    type: "object",
    properties: {
      verdict: { type: "keyword" },
      reasoning: { type: "text" },
      metCriteria: { type: "keyword" },
      unmetCriteria: { type: "keyword" },
    },
  },
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
