# N+1 Query Optimization for Scenario Events

## Problem Identified

The scenario events service had a significant N+1 query problem in two methods:

1. **`getScenarioRunDataByScenarioId`** - Fetched data for multiple scenario runs using individual queries
2. **`getRunDataForBatchIds`** - Fetched data for multiple scenario runs using individual queries

### Before (N+1 Queries)

```typescript
// For each scenario run ID, make 3 separate Elasticsearch queries
const runs = await Promise.all(
  scenarioRunIds.map((id) =>
    this.getScenarioRunData({ projectId, scenarioRunId: id })
  )
);
```

**Query Count**: 3N queries where N = number of scenario runs

- N queries for run started events
- N queries for message snapshot events
- N queries for run finished events

## Solution Implemented

### 1. New Batch Repository Methods

Added three new batch methods to `ScenarioEventRepository`:

- **`getRunStartedEventsByScenarioRunIds`** - Fetches run started events for multiple runs in one query
- **`getLatestMessageSnapshotEventsByScenarioRunIds`** - Fetches message events for multiple runs in one query
- **`getLatestRunFinishedEventsByScenarioRunIds`** - Fetches run finished events for multiple runs in one query

### 2. New Batch Service Method

Added **`getScenarioRunDataBatch`** to `ScenarioEventService` that:

- Fetches all data in exactly 3 queries regardless of the number of scenario runs
- Uses `Promise.all` to run the 3 queries concurrently
- Maps the results efficiently using JavaScript Maps for O(1) lookups

### 3. Updated Existing Methods

Modified both problematic methods to use the new batch approach:

- `getScenarioRunDataByScenarioId` now uses `getScenarioRunDataBatch`
- `getRunDataForBatchIds` now uses `getScenarioRunDataBatch`

## Performance Impact

### Before

- **3N queries** for N scenario runs
- Example: 100 scenario runs = 300 queries

### After

- **3 queries total** regardless of number of scenario runs
- Example: 100 scenario runs = 3 queries
- **100x reduction** in query count for large datasets

## Implementation Details

### Elasticsearch Query Structure

```typescript
// Uses 'terms' query instead of individual 'term' queries
{ terms: { [ES_FIELDS.scenarioRunId]: validatedScenarioRunIds } }

// Field collapse ensures exactly one document per scenarioRunId
collapse: { field: ES_FIELDS.scenarioRunId }

// Dynamic sizing prevents hitting 10,000 limit
size: Math.min(validatedScenarioRunIds.length, 10000)
```

### Input Deduplication

```typescript
// Remove duplicate scenario run IDs before processing
const validatedScenarioRunIds = Array.from(
  new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id)))
);
```

### Result Processing

```typescript
// Elasticsearch field collapse guarantees one document per scenarioRunId
// No need for manual deduplication in the loop
const results = new Map<string, ScenarioRunData>();
for (const scenarioRunId of scenarioRunIds) {
  const runStartedEvent = runStartedEvents.get(scenarioRunId);
  const messageEvent = messageEvents.get(scenarioRunId);
  const runFinishedEvent = runFinishedEvents.get(scenarioRunId);
  // ... compose data
}
```

## Files Modified

1. **`scenario-event.repository.ts`** - Added 3 new batch methods
2. **`scenario-event.service.ts`** - Added batch method and updated existing methods

## Testing Considerations

- Verify that batch methods return the same data structure as individual methods
- Test with various numbers of scenario runs (0, 1, 10, 100+)
- Ensure error handling works correctly for partial failures
- Validate that the latest events are still correctly identified (using timestamp sorting)

## Improvements Made

### Field Collapse & Dynamic Sizing

- **Field Collapse**: Added `collapse: { field: ES_FIELDS.scenarioRunId }` to ensure exactly one document per scenario run
- **Dynamic Sizing**: Changed from fixed `size: 10000` to `Math.min(validatedScenarioRunIds.length, 10000)` to prevent hitting limits
- **Input Deduplication**: Added `Array.from(new Set(...))` to remove duplicate scenario run IDs before processing

### Benefits of These Improvements

- **Reliability**: Field collapse guarantees we get exactly one latest event per scenario run
- **Scalability**: Dynamic sizing prevents issues when processing large numbers of scenario runs
- **Efficiency**: Input deduplication reduces unnecessary processing
- **Performance**: Removed manual deduplication loops since Elasticsearch handles it

## Future Optimizations

- Consider implementing pagination for very large batches (>1000 scenario runs)
- Add caching layer for frequently accessed scenario run data
- Monitor Elasticsearch performance with larger result sets
- Consider implementing parallel processing for result composition if needed
