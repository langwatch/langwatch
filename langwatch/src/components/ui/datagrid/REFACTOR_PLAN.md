# DataGrid Architecture Refactoring Plan

## Problem Statement

The current DataGrid implementation uses **both** Zustand store AND TanStack Table, but:
1. Zustand holds UI state (sorting, filters, etc.)
2. TanStack Table is used with `manualSorting: true`, `manualFiltering: true` - meaning it's **just a rendering engine**, not managing state
3. Data (rows) is stored in Zustand but **not persisted** (correct)
4. UI preferences ARE persisted (correct)

### The Real Question: Is This Wrong?

**No, this is actually a reasonable architecture.** Here's why:

| Concern | Current Approach | TanStack-Only Approach |
|---------|-----------------|------------------------|
| Persistence | ✅ Zustand persist middleware handles localStorage | ❌ Would need custom solution |
| Server-side operations | ✅ `onStateChange` callback triggers data fetch | ✅ Same pattern needed |
| Multiple state values | ✅ Single store | ⚠️ Many useState calls |
| Type safety | ✅ Custom types match your domain | ✅ TanStack types |

### What IS Redundant

The current [`DataGridTable.tsx`](./DataGridTable.tsx:193) creates a TanStack table but **doesn't use its state management**:

```typescript
const table = useReactTable({
  data,
  columns: tanstackColumns,
  getCoreRowModel: getCoreRowModel(),
  getRowId: (row) => getRowId(row),
  manualSorting: true,      // <-- State managed externally
  manualFiltering: true,    // <-- State managed externally
  manualPagination: true,   // <-- State managed externally
});
```

This is **fine** - TanStack Table supports this pattern for server-side data. You're using TanStack as a **rendering utility** not a state manager.

## Recommendation: Keep Current Architecture with Minor Cleanup

### What to Keep
- Zustand store for all UI state (sorting, filters, visibility, etc.)
- Zustand persistence for localStorage
- Server data in Zustand but NOT persisted
- TanStack Table for rendering only

### What to Clean Up

1. **Pass TanStack state object** to `useReactTable` for consistency:

```typescript
const table = useReactTable({
  data,
  columns,
  state: {
    sorting: sorting ? [{ id: sorting.columnId, desc: sorting.order === 'desc' }] : [],
    columnVisibility: Object.fromEntries(
      columns.map(c => [c.id, visibleColumns.has(c.id)])
    ),
    expanded: Object.fromEntries(
      Array.from(expandedRows).map(id => [id, true])
    ),
    // etc.
  },
  manualSorting: true,
  manualFiltering: true,
  manualPagination: true,
  getCoreRowModel: getCoreRowModel(),
});
```

2. **Use TanStack's built-in row models** where useful:
   - `getExpandedRowModel()` for expansion
   - `getGroupedRowModel()` for grouping (instead of manual groupedData logic)

3. **Remove duplicate grouping logic** - current manual grouping in DataGridTable duplicates what TanStack provides

## Optional: Deeper TanStack Integration

If you want TanStack to do more work while keeping Zustand for persistence:

```typescript
// In DataGridTable.tsx
const table = useReactTable({
  data,
  columns,
  state: {
    sorting: convertToTanStackSorting(store.sorting),
    columnVisibility: convertToTanStackVisibility(store.visibleColumns),
    grouping: store.groupBy ? [store.groupBy] : [],
    expanded: convertToTanStackExpanded(store.expandedRows),
  },
  onSortingChange: (updater) => {
    const next = typeof updater === 'function'
      ? updater(table.getState().sorting)
      : updater;
    store.setSorting(convertFromTanStackSorting(next));
  },
  // ... similar for other state
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),    // Let TanStack sort if client-side
  getGroupedRowModel: getGroupedRowModel(),  // Let TanStack group
  getExpandedRowModel: getExpandedRowModel(),
});
```

## Conclusion

**Current architecture is NOT a mistake.** It's a valid pattern for:
- Server-side data with client-side UI preferences
- Persistence requirements
- Complex state that benefits from a store

**Minor improvements possible** but no major refactor needed.

## Action Items

| Priority | Task | Effort |
|----------|------|--------|
| Low | Pass state object to useReactTable for debugging visibility | 30 min |
| Low | Replace manual grouping with getGroupedRowModel | 1-2 hrs |
| Optional | Add TanStack onXChange handlers that sync to Zustand | 2 hrs |
