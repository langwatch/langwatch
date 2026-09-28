# Alerts, toasts and field errors

Three ways to tell someone something. Pick by how long the thing stays true
and where the reader is looking.

| Use             | When                                                                       | Example                                                                     |
| --------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Field error** | One input is wrong and the reader can fix it there.                        | "Enter a valid email address" under the email field.                        |
| **Alert**       | Something is still true about this screen, drawer or form.                 | A missing provider key; a budget nearly spent; a panel that failed to load. |
| **Toast**       | Something just happened, and the screen itself does not change to show it. | "Prompt saved"; "Two members were invited".                                 |

Rules of thumb:

- A server rejection that names fields goes on the fields
  (`applyHandledErrorToForm`), a whole-form refusal into `<FormServerError>`.
  Never a toast: the reader is looking at the form.
- A failure that is still in effect is an alert (`<HandledErrorAlert>`), not a
  toast. A toast disappears while the problem stays.
- Never both. A toast repeating an alert on the same screen says the thing
  twice. See [error-handling.md](error-handling.md) for the error surfaces.

## How an alert looks

Use Chakra's `Alert` as is. The design system's recipe
(`packages/design-system/src/system/alert.recipe.ts`) gives every alert the
card material with a faint wash of its status colour, a hairline in that colour
and a status-coloured icon, with the text in the ordinary foreground colours.
The wash is a tint, never a fill: 12 percent of the status colour into
`bg.surface` in light, 16 percent into `bg.panel` in dark, enough that a warning
reads orange in both modes (ruled by Alex, 2026-09-28).

| `variant`          | Looks like                                                | Use it for                                                 |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `subtle` (default) | Tinted card material, status hairline.                    | Almost everything.                                         |
| `surface`          | Card material, neutral hairline, status edge on the left. | A page-level notice or empty state that heads a page.      |
| `outline`          | No ground of its own, status hairline.                    | An alert on a surface that paints its own ground (glass).  |
| `solid`            | Filled.                                                   | Rare: the one thing on the screen that must not be missed. |

`status` is one of `info`, `success`, `warning`, `error`, `neutral`. Set the
status, not a `colorPalette`; a palette alone is for a brand accent that is not
a status (the onboarding nudges).

`size="sm"` is the compact alert: smaller padding, 12px text and a 12px icon
that still sits on the title's line. Use it on dense surfaces (a trace panel,
a canvas node, a popover, a table cell) instead of shrinking an alert by hand.

Do not restyle an alert at the call site. `bg`, `borderColor`, `color`,
`borderRadius`, `padding`, `opacity`, a hand-drawn left border, or a
`fontSize` on its title or description all fight the recipe, and one screen
drifts from the rest. Margins, width and position are layout and belong to the
call site. The workshop shows every status in every variant in both colour
modes: `Primitives/Alert` in `pnpm --filter @langwatch/design-system storybook`.

## How toasts stack

The shared `Toaster` (`@langwatch/design-system/toaster`) stacks in place, as
Sonner does (ruled by Alex, 2026-09-28):

- Collapsed, the newest toast is in front and up to two older ones peek behind
  it, each a little smaller. Nothing beyond three shows.
- Hovering or focusing the stack fans it out so every toast can be read, and
  every timer holds while it is fanned out.
- One toast shows alone; two and three show as peeking cards; more than three
  add a "+N more" chip to the front card.
- A toast with a lifetime draws a thin bar that drains as it runs and holds with
  its timer. A loading or persistent toast draws none.
- Under reduced motion the stack does not animate and no bar is drawn.

Raise toasts through `toaster.create`; never render a second toaster or a
floating box of your own.
