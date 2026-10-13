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
   ghost. A secondary may carry a `tone` (`danger` red, `success` green, `info` blue, default
   neutral) and a footer may give several in `secondaryActions`; they stay outline and need no
   primary (ruling 2026-10-11). Disabled only with a `disabledReason`, shown as a tooltip (ADR-018: never validation).
   An overlay owns a form through `onSubmit` (and `formId`); a child form is never wrapped.
3. **One width scale.** `sm` 28rem, `md` 32rem, `lg` 42rem, `xl` 56rem, `full` (drawers only),
   the same name meaning the same width in a drawer and a dialog. They are maxima, capped by the
   viewport and the docked panel's inset. Drawer `2xl` and the dialog `maxWidth`s retire.
4. **Drawer Cancel only when asked** (late ruling, 2026-10-11, supersedes Q2): a drawer footer
   draws Cancel only when its descriptor carries `cancel`; existing Cancels stay. Dialogs keep
   Cancel. Dialogs take `placement` "top" (default) or "center"; Card takes `padding="lg"` (20px). `dismissible={false}` drops the X, Cancel, Escape and
   outside click; `role` is separate.
5. **Drawer ground** (Q3, superseded by the late ruling, 2026-10-11): the body keeps today's
   opaque `bg`; only the header band and footer turn partly translucent (card material, blur,
   a scroll-dependent edge), over a body that scrolls beneath them. It is on by default since Alex
   approved the light and dark screenshots (2026-10-11); the switch is `DRAWER_GLASS_DEFAULT`
   (`overlays/drawer-chrome.rules.ts`). See [drawers](../../../dev/docs/best_practices/drawers.md).
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
15. **Bounded capabilities that keep today's look** (DS-cap1, 2026-10-11). Each is optional,
    finite and absent by default, so a caller that does not pass it draws exactly what it drew.
    - `Card variant="frame-fill"`: the editor frame (1px `border`, radius `md`, transparent,
      no shadow or blur) that fills a bounded parent (`flex: 1`, `min-height: 0`, clipped),
      zero inset by default, header and footer never shrink, the editor owns its scrolling. The
      parent supplies the height; the card never reads the viewport.
    - `Card opener`: a native link, a link component that renders one, or a button, stretched
      under the card as its one focus target, named by its own label, text or a string `title`.
      `actions` and `footer` are refused by type beside it, because the children are only
      presentation. Buttons are `type="button"`. The opener opts in to the existing link-tile
      paint: border `border`, hover border the product accent's `emphasized` with `shadow sm`
      over 150ms (none under reduced motion), focus ring `focusRing` drawn inside the card.
      Without an opener a card gains no cursor, hover or focus response.
    - `Drawer icon`: decorative, before the title, a slot of at least 24px that never clips or
      shrinks its child; no icon draws the header it had. `Dialog icon` is untouched.
    - `Drawer backButtonTestId`: the Back button's id, else `<data-testid>-back`, else none.
      `FrameAction`'s sibling `cancel` descriptor takes `data-testid` for the Cancel button.
    - `Dialog closeOnInteractOutside` (default true): `false` ignores an outside click only, so
      X and Escape keep their `dismissible` and `busy` rules. It is not `dismissible={false}`.
    - `Dialog cancelLabel={null}` (DS-cap2): drops the default Cancel when one primary action
      finishes the job; the X and Escape stay under `dismissible` and `busy`, default unchanged.
    - Held-site additions (2026-10-11), all finite and optional: `Card tone` (teal, blue, yellow,
      red, purple, green, neutral) on `nested`, a tinted well in the tone's muted border, subtle
      fill and foreground heading, neutral being a plain inset; `Card variant="accent-row"`, a
      compact row whose 2px left edge alone carries the tone; `Card variant="emphasized"` (border
      `border.emphasized`, `bg.panel`, radius 2xl); `Card padding` `xl` (24px) and `inline-lg`
      (24px across, 20px down). A toned card or an accent row is a surface, never an opener.
    - `FrameLinkAction` joins `FrameAction`: a real anchor (`href`, `target`, `rel`, `onNavigate`,
      `onActivate`) in the action look. Only a plain primary click runs `onActivate` and
      `onNavigate`; modified, middle and `_blank` activations stay native. Busy, loading or
      unavailable, it loses its `href` and says `aria-disabled`. `Dialog secondaryActions` and a
      toned `secondaryAction` reach the same ActionRow the Drawer uses.

## Consequences

The part statics (`Drawer.Root`, `Dialog.Content`, ...) stay, marked `@deprecated`, so callers
migrate wave by wave; W-final deletes them with the `studio-*` subpaths and the `SettingsCard`,
`DetailDrawerHeader` and `WorkflowCard` aliases. Popups inside every drawer and dialog now portal
into it rather than the body.

## Amendment DS3 (2026-10-11): the remaining rollout surfaces

Rulings: `.claude/tmp/ds-sweep/plan/RULINGS-DS3.md`. New options are opt-in; omitted props keep today's look.

- **Primary tone.** `primaryAction.tone` is `accent` (default), `neutral` (the inverse button, `bg=fg`) or
  `success` (green). `danger` wins over any tone. Secondary success stays outline.
- **Footer node.** `Drawer.footerContent` and `Dialog.footerContent` replace the ActionRow's contents in the
  same band; they exclude the descriptor footer, and a Dialog's `cancelLabel`, `note` and actions. The caller
  owns the controls and passes its own busy flag, including to an already-open portalled menu.
- **Dialog controls.** `closeOnEscape`, `trapFocus` and `preventScroll` default to true. The opt-outs exist for
  the workflow create dialog, an integration whose emoji picker sits outside the frame; this is the one
  documented exception to ADR-001's trapped modal default. `body="flush"`, `ground="panel"` and
  `footerDivider` are finite options; `headerContent` and `surface="assistant"` serve the Langy create frame.
- **Widths.** `detail` (38.5rem) on Drawer and Dialog, `wide` (59.375rem) on Drawer. `Drawer.chrome="content"`
  with `headerContent` is a transparent bounded frame whose children own header and scrolling; the frame
  draws the one X. `Drawer.topInset="studio-header"` keeps the studio's 56px top clearance.
- **Card.** `invalid` (frame), `variant="joined-panel"` with `edge`, `padding="xs"`, `borderTone` (nested).

## Amendment DS4 (2026-10-11): finite frame options for the trace and workflow dialogs

Dialog gains `headerAppearance` (default, divided, muted, guide), `heightLimit` (reading),
`footerAppearance` (note, for `footerContent` only), `surface="glass"` (card ground only; panel plus
glass is refused), `showCloseButton`, `descriptionId` (with `headerContent`) and size `document`
(64rem). Drawer gains size `workspace` (87.5rem), `closeOnEscape` as a yes/no guard read at Escape
time, `preventScroll` and `footerAppearance="raised"`. Card gains `banded` (with `bandTone`),
`panel-fill` and `image-frame`. Pagination gains `layout`, `ground`, `summaryTone` and, for a known
total, `totalSummary`. Defaults keep every existing consumer unchanged.

Compatibility exception: the trace raw-JSON, edit-diff, share and shortcut dialogs and the two lens
dialogs pass `trapFocus={false}` and `preventScroll={false}` explicitly, as their local wrapper did.
It is scoped to those dialogs and is not copied to others.
