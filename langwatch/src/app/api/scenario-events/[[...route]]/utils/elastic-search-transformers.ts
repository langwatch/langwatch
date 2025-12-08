// utils/elastic-search-transformers.ts

/**
 * Elasticsearch field names for scenario events.
 * We use this to guarantee that the field names are consistent across the application
 * and prevent any inconsistencies/bugs.
 * @description This is a mapping of camelCase field names to snake_case field names for Elasticsearch.
 */
export const ES_FIELDS = {
  projectId: "project_id",
  scenarioId: "scenario_id",
  scenarioRunId: "scenario_run_id",
  batchRunId: "batch_run_id",
  scenarioSetId: "scenario_set_id",
  rawEvent: "raw_event",
  metCriteria: "met_criteria",
  unmetCriteria: "unmet_criteria",
} as const;

/**
 * Transforms camelCase field names to snake_case for Elasticsearch storage
 */
export function transformToElasticsearch(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...event };

  Object.entries(ES_FIELDS).forEach(([camelKey, snakeKey]) => {
    if (camelKey in result) {
      result[snakeKey] = result[camelKey];
      delete result[camelKey];
    }
  });

  return result;
}

/**
 * Transforms snake_case field names back to camelCase for application use
 */
export function transformFromElasticsearch(
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...doc };

  Object.entries(ES_FIELDS).forEach(([camelKey, snakeKey]) => {
    if (snakeKey in result) {
      result[camelKey] = result[snakeKey];
      delete result[snakeKey];
    }
  });

  return result;
}
