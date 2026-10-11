# ADR-002: Drawers, dialogs and cards are prop-driven shapes

**Date:** 2026-10-11

**Status:** Accepted (rulings by Alex, 2026-10-11)

**Behavioural contract:**
[Drawer and dialog shapes](../specs/overlay-shapes.feature) and
[Card, resource tile, load more and the one-line empty state](../specs/card-shapes.feature)

**Related:** [ADR-001](./001-design-system-boundary.md), `dev/docs/design/guidelines.md` §2 and §4.

## Context

The 2026-10-11 census counted how call sites use each family. Where callers assembled parts,
the parts drifted: 92 of 100 drawers and 94 of 153 dialogs were restyled (19 and 54 distinct
restyles), and 127 of 211 cards (58 looks, plus 446 hand-drawn bordered boxes). Page headers,
built by the same kind of composition, held: 9 of 96 drifted. The parts composition ruled for
drawers and dialogs on 2026-09-29 therefore did not keep them the same.

## Decision

1. **Shapes where composition drifted.** `Drawer`, `Dialog` and `Card` are callable components
   whose props carry content and intent only: no style prop exists, so a restyle does not
   compile. Page headers keep the composition and close their prop types instead.
2. **Footer buttons are descriptors.** `FrameAction` is a union: a button (`onClick`), a submit
   (`type: "submit"`, optional `form` id for a child-owned form) or a menu (`items`). The row
   (`ActionRow`, `@langwatch/design-system/action-row`) picks variant, colour and size by role:
   primary solid orange (red with `danger`), secondary outline, destructive ghost red, utility
   ghost. Disabled only with a `disabledReason`, shown as a tooltip (ADR-018: never validation).
   An overlay owns a form through `onSubmit` (and `formId`); a child form is never wrapped.
3. **One width scale.** `sm` 28rem, `md` 32rem, `lg` 42rem, `xl` 56rem, `full` (drawers only),
   the same name meaning the same width in a drawer and a dialog. They are maxima, capped by the
   viewport and the docked panel's inset. Drawer `2xl` and the dialog `maxWidth`s retire.
4. **Drawer Cancel only when asked** (late ruling, 2026-10-11, supersedes Q2): a drawer footer
   draws Cancel only when its descriptor carries `cancel`; existing Cancels stay. Dialogs keep
   Cancel. Dialogs take `placement` "top" (default) or "center"; Card takes `padding="lg"` (20px). `dismissible={false}` drops the X, Cancel, Escape and
   outside click; `role` is separate.
5. **Drawer ground** (Q3): the ruled ground is `bg.overlay`, but the shape keeps today's solid
   `bg` until Alex has seen light and dark screenshots. The switch is one constant,
   `DRAWER_GROUND` in `drawer.tsx`.
6. **Closing is a request.** `onClose` asks; the overlay stays until `open` turns false. `busy`
   holds the X, back, Escape, outside click and every action. The design system stays
   router-free: a routed drawer passes `closeDrawer` and `goBack`.
7. **Every overlay has the error boundary.** A render crash shows an inline error inside a
   still-named overlay with its close control, resetting when the title changes. The shell says
   once whether the build is development, through `DesignSystemProvider isDevelopment`.
8. **Popups portal into the overlay.** Drawer and dialog content provide a portal target
   (`useOverlayPortalTarget`); Popover, Menu and Select use it by default, so focus trapping
   stays on. `studio-drawer` and `studio-dialog` merge into `drawer` and `dialog` and remain as
   deprecated re-exports until W-final.
9. **Card.** Variants `panel`, `nested`, `frame`, `elevated`, `showcase`; padding `md` 16px,
   `sm` 12px, `none`. Gateway and governance keep their look as the one named `showcase`
   variant, used on purpose; their local panels retire into it. `CardGrid` decides width;
   `ResourceTile` is the clickable tile with a native opener; `SettingsCard` delegates to `Card`.
10. **Lists.** `LoadMore` ends an appending list; `NoDataInfoBlock size="line"` is the one-line
    empty state. `ListPage` is controlled by one `state` (`loading`, `error`, `empty`,
    `no-results`, `ready`): `error` and `empty` show their block alone, `loading` disables search,
    `no-results` keeps the toolbar, and only `ready` pages, loads more or selects. `pagination`
    and `loadMore` exclude each other. `refreshing` keeps the rows; an `error` beside `ready`
    is an inline notice. A missing `empty`, `noResults` or `error` config falls back to one
    generic line rather than a blank page. `back` is `{ label, href, onNavigate }`.
11. **Page header closes by types, not by removal.** `PageLayout.Header`, `Heading`, `Subtitle`
    and `HeaderButton` take closed props (no style props). `HeaderButton` keeps a link branch
    (`asChild` with one element carrying `href`, `target`, `rel`) and composes with
    `Menu.Trigger`. The old open props remain as a `@deprecated` overload until the callers
    migrate (the review's rank 6). `Container` stays open until its `maxWidth="full"` callers
    have a semantic replacement.
12. **List table scrolling is the table's.** `ListTable` takes `scroll="x"` with a
    `scrollLabel` (a focusable, named region) or `scroll="external"` (an outer virtual
    scroller; nothing clips). `Table.*` parts, `tableLayout`, `minWidth` and column widths stay;
    `containerProps` and open `Table.Root` props are the `@deprecated` overload. `RawTable`
    remains the escape for virtual grids.
13. **DeleteConfirmationDialog** is built on `Dialog` (`role="alertdialog"`), same public props;
    its confirm is gated with a `disabledReason` naming the phrase.
14. **Rules switch on tree-wide at zero** (Q4); reasoned disables only for
    `no-raw-overlay-parts`, `no-hand-drawn-card`, `no-raw-table` and `no-raw-page-title` (Q6).

## Consequences

The part statics (`Drawer.Root`, `Dialog.Content`, ...) stay, marked `@deprecated`, so callers
migrate wave by wave; W-final deletes them with the `studio-*` subpaths and the `SettingsCard`,
`DetailDrawerHeader` and `WorkflowCard` aliases. Popups inside every drawer and dialog now portal
into it rather than the body.
