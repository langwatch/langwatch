# Annotation Counts Optimization

## Problem

The `AnnotationsLayout.tsx` component was using the heavy `useAnnotationQueues` hook to fetch full data objects (including traces and annotations) just to display count badges in the sidebar. This was inefficient because:

1. **Over-fetching**: We were fetching complete trace and annotation data just to count items
2. **Performance impact**: Large datasets were being transferred and processed unnecessarily
3. **Redundant queries**: The same heavy query was being used for simple count operations

## Solution

### New Optimized Endpoints

Created three dedicated count endpoints that return only the necessary data:

1. **`getPendingItemsCount`** - Returns total count of pending items accessible to the user
2. **`getAssignedItemsCount`** - Returns count of items directly assigned to the user
3. **`getQueueItemsCounts`** - Returns counts for each queue where the user is a member

### Implementation Changes

#### Backend (`annotation.ts` router)

- Added `getAssignedItemsCount` endpoint for user-assigned items
- Added `getQueueItemsCounts` endpoint for queue-specific counts
- Both endpoints use efficient `count()` queries instead of fetching full data

#### Frontend (`AnnotationsLayout.tsx`)

- Replaced `useAnnotationQueues` hook with three optimized count queries
- Updated sidebar to use dedicated count data
- Maintained same UI behavior with better performance

#### Cache Invalidation

Updated all places where queue items are created or marked as done to invalidate the new count queries:

- `my-queue.tsx` - When marking items as done
- `MessagesTable.tsx` - When creating queue items from messages
- `TraceDetails.tsx` - When creating queue items from trace details

## Performance Benefits

1. **Reduced data transfer**: Count queries return minimal data vs full objects
2. **Faster queries**: Database count operations are much faster than fetching full records
3. **Better caching**: Count queries can be cached more effectively
4. **Improved UX**: Sidebar loads faster and updates immediately

## Architecture Decision

This optimization follows the principle of **query optimization by purpose**:

- Use specialized endpoints for specific use cases
- Avoid over-fetching data when only counts are needed
- Maintain separation between data fetching for display vs counts for UI indicators

## Related Files

- `src/server/api/routers/annotation.ts` - New count endpoints
- `src/components/AnnotationsLayout.tsx` - Updated to use optimized queries
- `src/pages/[project]/annotations/my-queue.tsx` - Cache invalidation
- `src/components/messages/MessagesTable.tsx` - Cache invalidation
- `src/components/traces/TraceDetails.tsx` - Cache invalidation
