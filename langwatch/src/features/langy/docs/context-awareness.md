# Langy context awareness — "glow and go"

The product intent: with the Langy panel open, the things on the page Langy can
use as context light up quietly, and one click hands them over. Multi-add,
ranges, and whole queries all work. Not too distracting, not too subtle, never
annoying.

Spec: `specs/langy/langy-context-awareness.feature` (page-side gesture) and
`specs/langy/langy-context-system.feature` (composer chips + the wire).

## The pieces

| Piece | Where |
|---|---|
| Target registry + picks + reveal | `stores/langyContextTargetStore.ts` |
| Opt-in hook / wrapper | `hooks/useLangyContextTarget.ts`, `components/LangyContextTarget.tsx` |
| Pointer proximity + the one "Absorb context" button | `components/LangyContextTargetLayer.tsx` |
| The visual (ring, shimmer, reduced-motion) | `langyContextTarget.css` |
| Chip identity (one resource = one chip id) | `logic/langyContextChips.ts` |
| Chip composition per page | `hooks/useLangyPageContext.ts` (+ drawer / selection / filter sub-hooks) |
| `#trace` kind intents | `logic/langyContextKindIntent.ts` |
| First-time hint | `components/LangyContextDiscoveryHint.tsx`, `logic/langyContextDiscovery.ts` |
| The wire + prompt rendering | `server/app-layer/langy/langyTurnContext.schema.ts` |

## The affordance: a proximity field, not a page-wide glow

The brief imagined everything eligible glowing when the panel opens, with one
"breathe" pulse. Implemented literally, a traces page would ring five hundred
rows at once — the christmas tree this design keeps walking back from. What
shipped instead:

- **Targets light up around the pointer.** `LangyContextTargetLayer` tracks the
  pointer and marks what is within ~140px (`near`, a faint shimmer ring) and
  what is under it (`hover`, firmer, plus the button). The field follows your
  hand; the rest of the page stays a page.
- **Adding is an explicit act on an explicit control.** Hovering a target
  floats one "Absorb context" button over it (one portal node for the whole
  page). The target's own click is never touched — a row still opens its
  drawer. An earlier cut hijacked the click and made every row un-openable;
  that failure is documented in the hook and must not come back.
- **`added` stays lit.** Everything Langy holds is visible at a glance while
  the panel is open, pointer or no pointer.
- **Zero cost when closed** — structural, not best-effort: no class, no data
  attribute, no listeners, no store writes. The wrapper returns its child
  untouched.
- **Reduced motion:** no shimmer, no fades; each state settles on a static
  ring color. States still read, nothing moves.
- **The ring never affects layout** (outline / inset shadows only), and table
  rows paint it per-cell because a sticky positioned cell paints over an
  ancestor's outline.

## The interaction

- **Click "Absorb context"** → chip appears in the composer tray. Click again
  (or the chip's ✕) → released. `absorbContextTarget` / `releaseContextTarget`
  in the store are the single definition of both, shared by the button, the
  hook's toggle, and the palette.
- **Multi-add:** keep absorbing; chips accumulate (the wire caps at 12).
- **Range:** the traces table's existing bulk selection becomes ONE
  `selection` chip ("N traces selected", ref = the ids). We reuse the table's
  selection model rather than inventing shift-click on rings.
- **Query:** the traces table's live filter state becomes ONE `filter` chip;
  its ref is the query itself, so the agent can run, narrow, or count it.
  This is the scalable form — never 500 chips.
- **Identity:** a chip id is `kind:resourceId`, minted identically by every
  source (route, drawer, row click, palette) via the factories in
  `langyContextChips.ts`. `mergeContextChips` keeps the first claim
  (most-specific source first), so a routed trace and its clicked row collapse
  into one chip.

## From the text box: `#`

The pointer route and the keyboard route teach each other:

- `#` lists the chips in reach AND an "On this page" group — everything
  registered as a target that isn't already a chip. Picking one absorbs it.
- `#trace` (or `#datasets`, `#evals`…) when the query names a KIND rather than
  a resource appends an intent row:
  - targets of that kind are on this page → **"Show traces on this page"**:
    the matching targets light up for a moment (`requestReveal`, the `near`
    ring, ~2.6s, capped at 30) so the user sees what can be taken;
  - none here → **"Browse traces"**: navigates to the surface
    (`SURFACE_PATH_FOR_KIND`), and a pending reveal lights the rows up as they
    mount there (15s TTL so a page visited later doesn't glow out of nowhere).
- The context palette carries one quiet footer line pointing at the page
  gesture.

The reveal is the brief's "breathe once", repurposed: it fires only when the
user asks for it, which is the only pulse that can never be annoying.

## Discovery

One dismissible hint above the composer, only when the panel is open on a page
that actually has targets, only until the user dismisses it or absorbs their
first thing (doing the thing is the best dismissal). Retired forever in
localStorage (`langwatch:langy:context-discovery:v1`). No toasts, no tours.

Deviation from the brief: the hint lives inside the panel, not anchored to a
page element — with a proximity field nothing glows until the pointer moves,
so a page-anchored callout would point at nothing, and a page overlay is
exactly the ambient cost the design forbids.

## The wire

Chips ride the turn as `pageContext` (`langyTurnContextSchema`), imported by
both the route and the panel so the contract cannot drift. Server-side,
`renderLangyTurnContext` renders them into a system block: sanitized (newlines
and backticks stripped — a label must never become a line of system prompt),
explicitly marked as DATA not instructions, and never resolved by the control
plane — a ref only gains meaning when the agent's own project-scoped tools
resolve it (ADR-047). Nothing in this feature changes the Go side.

## The annoyance budget, as invariants

- Panel closed → literally nothing: no styles, no listeners, no registry.
- Lit at once: what is near the pointer, what is added, and (briefly, on
  request) a capped reveal. Never the whole page.
- The shimmer is 11s, low-alpha, per-target phase-offset ("light on water",
  not a barcode); `added` is still.
- One hint, once per browser, self-retiring.
- The affordance button exists once per page, only under the pointer.

## Wired surfaces

- Traces table rows (`features/traces-v2` StatusRow/RegistryRow — hook form,
  the root is the virtualizer's `<tbody>`), the trace drawer, bulk selection
  and filter as chips.
- Online evaluation rows (`components/evaluations/OnlineEvaluationsTable.tsx`).
- Dataset rows (`pages/[project]/datasets.tsx`), dataset route chip.
- Published prompts (`prompt-playground` sidebar), prompt editor drawer chip.
- Routes and drawers derive chips with no page wiring at all
  (`useLangyPageContext`, `useLangyDrawerContext`).

Deferred: dataset record ranges (the editor grid has no per-row identity worth
a chip yet), analytics graphs / dashboards (`dashboard` kind exists on the
wire; no surface registers targets), annotations, simulations grid (the run
drawer already yields a `scenario` chip).
