# Simulation Query Hooks

Centralized location for all simulation-related data fetching hooks.

## Overview

All simulation queries are now centralized in `useSimulationQueries.ts` to provide:
- **Single source of truth** for all simulation data fetching
- **Consistent patterns** for caching, polling, and error handling  
- **Clear documentation** on which hook to use when
- **Encapsulated complexity** (e.g., pagination logic is fully contained)

## Available Hooks

### `useScenarioRunIds`
**Purpose:** Get lightweight scenario run IDs for a specific batch run  
**Use case:** Main grid rendering where cards fetch their own details  
**Optimization:** ~95% smaller payload than full data  
**Polling:** 1 second interval  

```typescript
const { data: scenarioRunIds } = useScenarioRunIds({
  scenarioSetId,
  batchRunId,
});
```

### `usePaginatedBatchRuns`
**Purpose:** Get paginated batch runs with full pagination logic  
**Use case:** Sidebar batch run history  
**Encapsulates:** Cursor state, history, next/prev navigation  
**Polling:** 1 second interval  

```typescript
const {
  runs,
  currentPage,
  totalPages,
  nextPage,
  prevPage,
  hasMore,
  hasPrevious,
} = usePaginatedBatchRuns({
  scenarioSetId,
  limit: 8,
  enabled: false, // Manually controlled
});
```

### `useScenarioRunState`
**Purpose:** Get individual scenario run with full details  
**Use case:** Individual scenario run cards  
**Smart polling:** Automatically stops when run completes  
**Optimization:** Stabilizes messages reference to prevent re-renders  

```typescript
const { data } = useScenarioRunState({
  scenarioRunId,
  enabled: false, // Can be manually controlled
});
```

### `useScenarioSets`
**Purpose:** Get all scenario sets for a project  
**Use case:** Simulations list/overview page  
**Polling:** Adaptive (4s focused, 30s blurred)  

```typescript
const { data: scenarioSets } = useScenarioSets({
  refetchInterval: 4000,
});
```

### `useBatchRunCount`
**Purpose:** Get total count of batch runs  
**Use case:** Pagination UI, statistics  

```typescript
const { count } = useBatchRunCount({
  scenarioSetId,
});
```

## Migration Status

✅ **Completed:**
- `index.tsx` - Now uses `useScenarioRunIds`
- `SimulationChatViewer.tsx` - Now uses `useScenarioRunState`  
- `useSetRunHistorySidebarController.ts` - Now uses `usePaginatedBatchRuns`

## Benefits

1. **Reduced complexity** - Pagination logic fully encapsulated in hook
2. **Consistent caching** - All queries follow same patterns
3. **Better documentation** - JSDoc explains when to use each hook
4. **Easier optimization** - Change logic in one place
5. **Type safety** - Centralized hooks provide consistent types

## Direct API Usage

⚠️ **Avoid direct `api.scenarios.*` calls** - Use these centralized hooks instead.

The hooks provide better abstractions and consistent behavior across the app.

