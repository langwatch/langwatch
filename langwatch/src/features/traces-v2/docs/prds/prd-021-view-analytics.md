# PRD-021: Lens Analytics

Parent: [Design: Trace v2](../design/trace-v2.md)
Phase: 2 (Lens Engine)
Status: DRAFT
Date: 2026-04-23

## What This Is

Invisible instrumentation that tracks how users interact with lenses. Which lenses they create, which columns they enable, which groupings they use, how often they switch lenses. No user-facing UI. Just event logging.

This data feeds Phase 4 AI-generated lenses. If the AI knows that 80% of users enable the Cost column and group by Model, it can generate smart default lens configs instead of guessing. Without this data, the AI has no signal. With it, the AI has evidence.

## Event Schema

```typescript
type LensAnalyticsEvent = {
  timestamp: string;   // ISO 8601
  projectId: string;   // current project
} & (
  | { type: 'lens_created'; lensId: string; name: string; columns: string[]; grouping: string }
  | { type: 'lens_switched'; fromLensId: string; toLensId: string }
  | { type: 'lens_saved'; lensId: string; changes: string[] }
  | { type: 'lens_deleted'; lensId: string }
  | { type: 'lens_renamed'; lensId: string; oldName: string; newName: string }
  | { type: 'lens_duplicated'; sourceLensId: string; newLensId: string }
  | { type: 'lens_reverted'; lensId: string }
  | { type: 'column_toggled'; lensId: string; columnId: string; visible: boolean }
  | { type: 'column_reordered'; lensId: string; columnId: string; fromIndex: number; toIndex: number }
  | { type: 'column_resized'; lensId: string; columnId: string; width: number }
  | { type: 'grouping_changed'; lensId: string; from: string; to: string }
  | { type: 'conditional_format_added'; lensId: string; columnId: string; operator: string; value: number; color: string }
  | { type: 'conditional_format_removed'; lensId: string; columnId: string }
  | { type: 'draft_discarded'; lensId: string }
);
```

Each event includes `timestamp` and `projectId` automatically. The `lensId` references the LensConfig.id.

## When Events Fire

| User Action | Event Type | Notes |
|-------------|-----------|-------|
| Click [+] and save a new lens | `lens_created` | Captures initial config |
| Click a different lens tab | `lens_switched` | Tracks which lenses get used |
| Save (overwrite) a lens | `lens_saved` | `changes` lists what was modified |
| Delete a custom lens | `lens_deleted` | |
| Rename a lens | `lens_renamed` | |
| Duplicate a lens | `lens_duplicated` | |
| Revert changes on a lens | `lens_reverted` | |
| Toggle column visibility | `column_toggled` | Per-column granularity |
| Drag-to-reorder a column | `column_reordered` | Only on drop (not during drag) |
| Resize a column (release handle) | `column_resized` | Only on mouseup (not during drag) |
| Change grouping dropdown | `grouping_changed` | |
| Add a conditional formatting rule | `conditional_format_added` | |
| Remove a conditional formatting rule | `conditional_format_removed` | |
| Navigate away from modified lens | `draft_discarded` | Silent discard tracking |

### Debounce Rules

- **Column resize:** Only log on mouseup/pointerup. Do not log intermediate drag positions.
- **Rapid lens switching:** No debounce. Each switch is meaningful (tracks exploration patterns).
- **Column toggle:** No debounce. Each toggle is a discrete action.

## Storage (Phase 2)

Phase 2 stores events in localStorage:

- **Key:** `langwatch:lensAnalytics:{projectId}`
- **Format:** JSON array of LensAnalyticsEvent objects
- **Cap:** 1000 events, FIFO (oldest events dropped when cap is reached)
- **No UI to view these events.** They're invisible. A developer can inspect them via browser DevTools for debugging.

### Why localStorage (not server)

Phase 2 runs against mock data in a test repo. There's no backend to receive analytics. localStorage is sufficient to:
1. Validate the event schema works
2. Accumulate usage patterns during dogfooding
3. Test that events fire at the right moments

Phase 3A replaces the localStorage writer with a real endpoint that ships events to the analytics backend.

## Migration Path (Phase 3A)

The analytics module exposes a single function:

```typescript
function trackLensEvent(event: Omit<LensAnalyticsEvent, 'timestamp' | 'projectId'>): void
```

Phase 2 implementation: appends to localStorage array.
Phase 3A implementation: sends to analytics endpoint via tRPC.

Components call `trackLensEvent()` in both phases. Only the implementation changes. Same pattern as the mock data provider hooks (PRD-017).

## Privacy

- Events contain lens IDs, column IDs, and grouping values. No trace content, no user data, no PII.
- Events are project-scoped (tied to projectId, not userId). In Phase 3A+, events may include an anonymized userId for per-user analytics.
- Phase 2 events never leave the browser. No network requests.

## Data Gating

- **localStorage unavailable** (private browsing, storage quota exceeded): Events silently fail. No error. No retry. Analytics is best-effort, never blocks the UI.
- **Storage quota exceeded:** Drop the oldest 100 events to make room, then write.
- **Corrupted event data:** If the stored array can't be parsed, silently reset to empty. Log a console warning.

## Future Use (Phase 4)

The accumulated analytics data will be used to:
1. **AI-generated lenses:** Train the model on which configurations users actually create (columns, grouping, formatting patterns)
2. **Smart default lenses:** Suggest lenses based on popular configurations across users in the same project
3. **Usage reporting:** Show team admins which lenses are most used, helping identify high-value persona patterns
4. **Onboarding:** Pre-populate suggested lenses for new users based on what similar projects configure
