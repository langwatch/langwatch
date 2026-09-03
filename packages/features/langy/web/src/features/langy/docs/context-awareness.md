# Langy context awareness

With the panel open, eligible page objects can be offered as Langy context. A
user explicitly chooses the context; merely visiting a page or opening a drawer
does not send its data to the agent.

Behavioural specs: `specs/langy/langy-context-awareness.feature` covers the
page gesture and `specs/langy/langy-context-system.feature` covers chips and
the turn wire.

## Ownership

| Concern                                                                                  | Owner                                                                 |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Target registration, proximity affordance, chip selection, and page-specific composition | `platform/app/src/features/langy`                                     |
| Portable turn-context values, schema factory, sanitising, and prompt rendering           | `packages/features/langy/contract/src/langy-turn-context.ts`          |
| Installed-skill list used to specialise the portable schema                              | `platform/app/src/runtime/app/features/langy-turn-context.adapter.ts` |

The app layer owns the UI gesture and route-derived offers. The contract owns
the portable values and the prompt boundary. The runtime supplies only the
installed skill identifiers, so package code does not depend on app modules.

## Interaction

- `LangyContextTargetLayer` highlights only targets near the pointer. A single
  explicit “Absorb context” control adds or removes the target without changing
  its normal click behaviour.
- `#` shows eligible, unselected targets and can add one. It never navigates or
  emits commands.
- A target stays visibly added while its chip is selected. Closing the panel
  attaches no target styles, listeners, or store updates.
- Trace selection and filter state each become one chip. Route, drawer, page,
  and picked-target candidates use stable `kind:resourceId` identities and
  merge most-specific first.
- Reduced-motion mode has static state indication rather than shimmer.

The reveal state in `langyContextTargetStore` has no product trigger. It is not
part of the supported interaction contract; remove it only together with its
registration path and tests, or add a deliberate trigger and coverage.

## Turn boundary

The panel validates `pageContext` and `skills` with the runtime-specialised
`langyTurnContextSchema`. The server renders the same contract values into a
system block. Labels and references are length-limited and sanitised, treated
as data rather than instructions, and resolved again through project-scoped
tools before use. A chip therefore cannot grant access or make an arbitrary id
trusted.

## Current surfaces

Trace rows and drawers, evaluation rows, datasets, prompts, route-derived
resources, and page-specific registrations can offer context. Dashboard,
annotation, and simulation-grid targets remain deferred until those surfaces
have a resource identity worth sending.
