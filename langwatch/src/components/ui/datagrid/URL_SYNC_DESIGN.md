# URL Sync Middleware Design

## Overview

Zustand middleware that syncs DataGrid state to URL query params, with priority:
1. **URL params** (highest) - enables shareable links
2. **localStorage** (fallback) - persists UI preferences
3. **Defaults** (lowest) - initial config

## Key Principle: Store Owns State

The component should NOT:
- Parse URL manually
- Build initial state
- Handle state change callbacks for URL sync

Instead, `createDataGridStore` handles everything internally via config:

```typescript
// Component is simple - just create store with URL config
const useStore = createDataGridStore<Row>({
  columns,
  getRowId: (row) => row.id,
  storageKey: "my-table",
  urlSync: {
    getSearchParams: () => window.location.search,
    setSearchParams: (params) => router.replace({ search: params }, { shallow: true }),
  },
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    createDataGridStore                   │
├─────────────────────────────────────────────────────────┤
│  1. Read URL params (via qs.parse)                      │
│  2. Read localStorage (via persist middleware)          │
│  3. Merge: URL > localStorage > defaults                │
├─────────────────────────────────────────────────────────┤
│  On state change:                                        │
│    - serialize to URL (via qs.stringify)                │
│    - call config.setSearchParams()                      │
│    - persist middleware handles localStorage             │
└─────────────────────────────────────────────────────────┘
```

## URL Params

Using `qs` library for nested object serialization:

| Param | Type | Example |
|-------|------|---------|
| `filters` | FilterState[] | `filters[0][columnId]=status&filters[0][operator]=eq&filters[0][value]=FAILED` |
| `sortBy` | string | `sortBy=timestamp` |
| `sortOrder` | "asc" \| "desc" | `sortOrder=desc` |
| `page` | number | `page=2` |
| `pageSize` | number | `pageSize=50` |
| `search` | string | `search=login%20error` |
| `groupBy` | string | `groupBy=status` |

## Implementation Plan

### Step 1: Add urlSync config to DataGridConfig

```typescript
interface DataGridConfig<T> {
  // ... existing config
  urlSync?: {
    getSearchParams: () => string;
    setSearchParams: (params: string) => void;
  };
}
```

### Step 2: Modify createDataGridStore

In `createStoreActions`, wrap `set` to sync URL on relevant state changes:

```typescript
const syncedSet = (partial) => {
  set(partial);
  if (config.urlSync) {
    const state = get();
    const urlParams = serializeURLState({
      filters: state.filters,
      sorting: state.sorting,
      page: state.page,
      pageSize: state.pageSize,
      globalSearch: state.globalSearch,
      groupBy: state.groupBy,
    });
    config.urlSync.setSearchParams(urlParams);
  }
};
```

### Step 3: Apply URL state on init

Before creating the store, parse URL and merge with defaults:

```typescript
if (config.urlSync) {
  const urlState = parseURLState(config.urlSync.getSearchParams());
  // Merge into initialState, URL takes priority
  Object.assign(initialState, urlState);
}
```

## Testing Strategy

### Unit Tests (pure functions) ✅ Done
- `parseURLState(searchParams: string): Partial<State>`
- `serializeURLState(state: State): string`
- `mergeURLState(url, localStorage, defaults): State`

### What NOT to test
- qs library internals
- Zustand middleware composition
- Next.js router

## Files

1. `urlSync.ts` - Pure parse/serialize utilities ✅ Created
2. `useDataGridStore.ts` - Add urlSync integration ⏳ Pending
3. `__tests__/urlSync.unit.test.ts` - Pure function tests ✅ Created (29 tests passing)

## Migration

After implementation, `ScenariosTableView.tsx` removes:
- `initialUrlState` ref and parsing logic (lines 28-52)
- `handleStateChange` callback (lines 260-290)
- Remove `onStateChange` prop from DataGrid

Component becomes:

```tsx
const useStore = createDataGridStore<ScenarioRunRow>({
  columns: baseColumns,
  getRowId: (row) => row.scenarioRunId,
  storageKey: project?.id ? `scenarios-table-${project.id}` : undefined,
  urlSync: {
    getSearchParams: () => window.location.search,
    setSearchParams: (params) => {
      const url = new URL(window.location.href);
      url.search = params;
      url.searchParams.set("view", "table");
      void router.replace(url.pathname + url.search, undefined, { shallow: true });
    },
  },
});
```
