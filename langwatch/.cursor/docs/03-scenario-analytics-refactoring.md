# Scenario Analytics Refactoring

## Overview

This document describes the refactoring of scenario analytics query construction logic to eliminate code duplication between `scenario_analytics.ts` and `backfillScenarioAnalytics.ts`.

## Problem

The query construction logic for Elasticsearch scenario analytics was duplicated across two files:

1. **`src/pages/api/cron/scenario_analytics.ts`** - Daily cron job for scenario analytics
2. **`src/tasks/backfillScenarioAnalytics.ts`** - Backfill task for historical scenario analytics

Both files had similar but slightly different query construction logic:

- `scenario_analytics.ts`: Simple count aggregation for a single day
- `backfillScenarioAnalytics.ts`: Date histogram aggregation for multiple days

## Solution

Created a shared module `src/server/scenario-analytics.ts` that provides:

### Core Function: `createScenarioAnalyticsQuery`

```typescript
function createScenarioAnalyticsQuery(options: ScenarioAnalyticsQueryOptions);
```

**Parameters:**

- `projectId`: Project identifier
- `eventType`: Event type to filter by
- `startTime`: Start timestamp
- `endTime`: End timestamp
- `includeDateHistogram`: Whether to include date histogram aggregation
- `dateHistogramOptions`: Configuration for date histogram

**Returns:** Array containing index and query objects for Elasticsearch msearch

### Convenience Function: `createScenarioAnalyticsQueriesForAllEventTypes`

```typescript
function createScenarioAnalyticsQueriesForAllEventTypes(
  projectId: string,
  startTime: number,
  endTime: number,
  includeDateHistogram = false,
  dateHistogramOptions?: DateHistogramOptions
);
```

Creates queries for all four event types:

- `*` (total events)
- `message_snapshot`
- `run_started`
- `run_finished`

## Changes Made

### 1. Created Shared Module

- **File:** `src/server/scenario-analytics.ts`
- **Purpose:** Centralized query construction logic
- **Features:** Supports both simple count and date histogram aggregations

### 2. Updated scenario_analytics.ts

- **Removed:** Duplicated `createEventTypeQueries` function
- **Added:** Import of `createScenarioAnalyticsQueriesForAllEventTypes`
- **Simplified:** Query construction to single function call

### 3. Updated backfillScenarioAnalytics.ts

- **Removed:** Duplicated `createEventTypeQuery` function
- **Added:** Import of `createScenarioAnalyticsQueriesForAllEventTypes`
- **Simplified:** Query construction with date histogram support

## Benefits

1. **Reduced Duplication:** Eliminated ~50 lines of duplicated code
2. **Improved Maintainability:** Single source of truth for query logic
3. **Consistency:** Ensures both files use identical query structure
4. **Flexibility:** Shared module supports both use cases
5. **Type Safety:** Strongly typed interface for query options

## Usage Examples

### Daily Analytics (scenario_analytics.ts)

```typescript
const msearchBody = projects.flatMap((project) =>
  createScenarioAnalyticsQueriesForAllEventTypes(
    project.id,
    startTimestamp,
    endTimestamp
  )
);
```

### Backfill Analytics (backfillScenarioAnalytics.ts)

```typescript
const msearchBody = createScenarioAnalyticsQueriesForAllEventTypes(
  project.id,
  startDate.getTime(),
  today.getTime(),
  true, // includeDateHistogram
  {
    calendarInterval: "day",
    format: "yyyy-MM-dd",
    timeZone: "UTC",
  }
);
```

## Related Files

- `src/server/scenario-analytics.ts` - Shared query construction module
- `src/pages/api/cron/scenario_analytics.ts` - Daily cron job (updated)
- `src/tasks/backfillScenarioAnalytics.ts` - Backfill task (updated)
