# Row actions on mobile: the action sheet

The React Native counterpart of `row-actions-overflow-menu.md`. The rule is the
same — **one trigger per row, never a row of buttons** — but a phone has no
hover, no right-click and no room for a popover, so the trigger opens a sheet
rather than a menu, and the sheet carries the confirmation instead of a separate
dialog.

Reference implementation: `mobile/src/features/actions/`. Add the next acted-on
surface there rather than reinventing the choose/confirm/run/report flow.

## The pattern

```tsx
// One tiny component per acted-on row: binding actions means calling hooks, and
// a screen cannot call a hook once per row inside a map.
export function GroupRowActions({ queueName, group }) {
  const actions = useGroupActions({ queueName, group });
  return <RowActions label={group.groupId} title="Group actions" actions={actions} />;
}
```

`RowActions` renders the trailing `⋯` and the sheet it opens. Rules:

- **One trigger, in the row's trailing position**, before any chevron. Give it
  an `accessibilityLabel` naming the row (`Actions for ${groupId}`) — "more
  options" tells a screen-reader user nothing about which row they are on.
- **A row with no available actions renders no trigger.** Not a disabled one,
  and not one that opens onto "nothing to do here".
- **Detail screens put the same component in `headerRight`.** A detail screen is
  a row you have opened; its actions belong in the same relative position.
- **Destructive items are tinted** with the theme's `critical`, matching the web
  menu's red.

## Three guardrails, chosen by what is at risk

Declared per action in `mobile/src/lib/actions.ts`, which is pure data and unit
tested. Do not scatter these decisions into screens.

| Risk | Guardrail |
| --- | --- |
| Reversible — the work still exists afterwards (unblock, unpause, replay, move to dead letters) | A plain confirmation step. |
| Blast radius not visible from the row the operator tapped (anything named "all") | `needsPreview` — the sheet fetches and shows what would be affected, and withholds the run button when the preview finds nothing. |
| The work is destroyed, not moved (drain, delete) | `confirmWord` — an exact-match typed word. |

Do **not** require a typed word everywhere. Asking for one on a reversible
action trains operators to type it without reading, which is exactly what it
exists to prevent. And exact means exact: no trimming, no case folding, and a
different word per action family so muscle memory from the last confirmation
does not carry over.

Where the server offers a **canary** (act on N first), offer it as its own
action *above* the sweeping one. It is not a guardrail on the big action; it is a
smaller action that makes proving a fix cheaper than applying it everywhere.

## Reporting

An action reports **what it did**, from the counts the server returned —
"Discarded 412 jobs", not "Done". A canary names the groups it touched, because
the point of trying five is being able to go and look at those five.

The sheet does not close itself on success. An operator who has just drained a
queue needs to read what it did, and a sheet that vanishes takes the only report
of that with it.

## Invalidation

Invalidate the whole surface the action moved, not the one list the operator was
looking at. An unblock moves the dashboard counters, the tab badge, the blocked
summary and the dead-letter list at once, and a screen still showing the old
number is how someone ends up running the same action twice. See
`useQueueInvalidation` in `useOpsActions.ts`.

## What does not belong in a sheet

- **Anything that needs a free-text identifier typed in.** Pausing a tenant means
  naming one, and a typo on a phone keyboard pauses the wrong tenant. Offer
  unpause on rows that are *already* listed as paused; leave the creation of a
  pause to the console.
- **Anything whose decision needs data the phone is not showing.** Starting a
  projection replay is chosen with the event log open in front of you.
- **Any action the server does not implement.** If there is no mutation behind
  it, it does not go in the catalog — a control that can only fail is worse than
  no control.
