# Drawer, Dialog, Card and the footer row: the current shapes

Rulings: `packages/design-system/adrs/002-overlay-and-card-shapes.md` (with its amendments).
Behaviour: `packages/design-system/specs/overlay-shapes.feature`, `card-shapes.feature`.
Source of truth for props (read the type, do not copy unions):

- Drawer: `packages/design-system/src/components/overlays/views/drawer-view.tsx` (`DrawerProps`)
- Dialog: `.../overlays/views/dialog-view.tsx` (`DialogProps`)
- Footer row and actions: `.../overlays/action-row.tsx` (`ActionRowProps`, `FrameAction`)
- Card: `.../layout/card.tsx` (`CardProps`, `CardGrid`)

Each of the three is a **callable component whose props carry content and intent only**. No style
prop exists, so a restyle does not compile. Never assemble parts in a module.

## Drawer (`@langwatch/design-system/drawer`)

```tsx
<Drawer
  title="Edit annotation" // required: the accessible name
  onClose={closeDrawer} // a request to close; see below
  onBack={canGoBack ? goBack : undefined}
  size="lg" // a maximum; default "md"
  footer={{
    primaryAction: { type: "submit", label: "Save", loading: saving },
    cancel: { onClick: closeDrawer }, // Cancel only when you pass it
  }}
  onSubmit={handleSubmit} // the drawer owns the form
>
  {body}
</Drawer>
```

- `open` defaults to true: a routed drawer is mounted only while open. `onClose` is a **request**
  (X, Escape): the drawer stays until `open` turns false. The design system is router-free, so a
  routed drawer passes the token drawer's `closeDrawer` and `goBack` (see `browser-module`).
- Header: `title`, `subtitle`, `eyebrow`, `badges`, `icon`, `headerAction`, `headerTools`,
  `toolbar` (pinned under it). Body: `body="flush"`, `bodyScroll="content"`, `loading` (skeleton
  rows), `error={{ title, description, onRetry }}` (inline banner).
- `busy` holds the X, back, Escape, outside click and every action while a save runs.
- Footer is **either** `footer` (an `ActionRow` descriptor) **or** `footerContent` (one node that
  owns the row, no Cancel added); never both. Form: `onSubmit` plus `formId`, or a
  `type: "submit"` action with `form` naming a child-owned form. Never wrap a child form.
- Every drawer has an error boundary; popups (Popover, Menu, Select) portal into the drawer.
- Sizes (maxima): sm 28rem, md 32rem, detail 38.5rem, lg 42rem, xl 56rem, wide 59.375rem,
  workspace 87.5rem, full. No arbitrary `maxWidth`.

## Dialog (`@langwatch/design-system/dialog`)

Same idea, with `open`, `onClose` and `title` all required (a dialog is mounted by its caller).

- `size` default `sm`; sm 28rem, md 32rem, detail 38.5rem, lg 42rem, xl 56rem, document 64rem.
  `placement` is `top` (default) or `center`.
- Footer: `primaryAction` (with `danger`, or `tone` accent|neutral|success), `secondaryAction`,
  `secondaryActions` (outline, optional tone), `cancelLabel` (default "Cancel", `null` drops it),
  `note`; or `footerContent`, which excludes all of those.
- `dismissible={false}` drops the X, Cancel, Escape and outside click. `closeOnInteractOutside={false}`
  ignores an outside click only. `role="alertdialog"` for a destroying confirm
  (`/delete-confirmation-dialog`, `/confirm-dialog` are built on it). `busy` and `onSubmit` as above.

## ActionRow and FrameAction (`/action-row`)

A footer button is a descriptor, so the row picks variant, colour and size by role: primary solid
(accent, or red with `danger`), secondary outline, destructive ghost red, utility ghost.
`FrameAction` is a button (`onClick`), a submit (`type: "submit"`, optional `form`), a menu
(`items`) or a link (`FrameLinkAction`: `href`, `onNavigate`, `onActivate`). A disabled action
needs a `disabledReason`, shown as a tooltip; never disable for validation (ADR-018).

## Card (`@langwatch/design-system/card`)

`<Card title description icon status badge actions footer padding variant>` with `CardGrid` laying
several out (`CardGrid` decides width). Not `Card` from `/primitives`: that name there is
`CardParts`, the legacy composable family (`Card.Root`, `Card.Body`).

- Common variants: `panel` (default, on a page), `nested` (a well inside a card, drawer or dialog),
  `frame` (a border round an editor or image), `elevated`, `showcase` (hero figures, on purpose).
  Finite extras: `frame-fill`, `panel-fill`, `joined-panel` (needs `edge`), `image-frame`,
  `accent-row`, `emphasized`, `banded` (needs `bandTone`). `tone` belongs to `nested` and `accent-row`.
- `padding`: xs 8px, sm 12px, md 16px (default), lg 20px, xl 24px, inline-lg 24px across and 20px
  down, none (a table, code block or editor fills it).
- A clickable card uses `opener` (a native link or button stretched under the card), which
  excludes `actions` and `footer`. `ResourceTile` is the clickable tile.

## Lists

`ListPage` is controlled by one `state` (`loading | error | empty | no-results | ready`).
`ListTable` takes `scroll="x"` with a `scrollLabel`, or `scroll="external"`. `LoadMore` ends an
appending list; `NoDataInfoBlock size="line"` is the one-line empty state.

## Legacy shapes, being removed

Do not write these in new code, and convert a call site you touch:

| Legacy                                                             | Current                            |
| ------------------------------------------------------------------ | ---------------------------------- |
| `Drawer.Root` / `.Content` / `.Header` / `.Body` / `DrawerActions` | `<Drawer title onClose footer>`    |
| `Dialog.Root` / `.Content` / `.Footer`, `DialogCloseTrigger`       | `<Dialog open onClose title ...>`  |
| `Card.Root` / `Card.Body` from `/primitives`                       | `Card` from `/card`                |
| `studio-drawer`, `studio-dialog` subpaths                          | `/drawer`, `/dialog`               |
| `DetailDrawerHeader`, `SettingsCard`, `WorkflowCard` aliases       | `Drawer` props, `Card`             |
| Drawer size `2xl`, dialog `maxWidth`                               | a named size from the scales above |

Checking whether a call site is legacy: `Drawer.Root`, `Dialog.Root` or `Card.Root` in a module
means it is. The part statics stay `@deprecated` until the final removal wave.
