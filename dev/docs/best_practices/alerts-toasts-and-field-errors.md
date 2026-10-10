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

Use `Banner` for page or section notices and `Alert` for a message local to a form
or task. Both carry a status icon as well as colour. The shared recipe uses two
broad, low-opacity washes of the same status hue over an opaque tint. It never
mixes a dark foreground step into the mesh. Body text uses the full foreground.

Banners are lightest, toasts sit between, and default alerts are strongest. Dark
mode uses a little more colour over `bg.panel` so statuses remain distinguishable.
The mesh adds texture, not a spotlight; no glow, blur or hue drift.

| `variant`          | Looks like                                 | Use it for                                   |
| ------------------ | ------------------------------------------ | -------------------------------------------- |
| `solid`            | Deep status fill with a very quiet mesh.   | Rare: the one thing that must not be missed. |
| `surface`          | Stronger status tint and hairline.         | A prominent local warning.                   |
| `subtle` (default) | Soft status tint and hairline.             | Most form and task messages.                 |
| `outline`          | Almost plain ground and a status hairline. | The quietest local message.                  |

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
modes: `Feedback/Alert` in `pnpm --filter @langwatch/design-system storybook`.

## How toasts stack

The shared `Toaster` (`@langwatch/design-system/toaster`) stacks in place, as
Sonner does (ruled by Alex, 2026-09-28):

- Collapsed, the newest toast is in front and up to two older ones peek behind
  it, each a little smaller. Nothing beyond three shows.
- Hovering or focusing the stack fans it out so every toast can be read, and
  every timer holds while it is fanned out.
- Each visible card behind the front one darkens gently with its depth. Its text
  is hidden until expansion, which restores the unshaded surface and readable text.
- One toast shows alone; at most three cards are visible in the collapsed stack.
- Reduced motion removes the entrance and stack transitions and keeps a brief exit fade.

Raise toasts through `toaster.create`; never render a second toaster or a
floating box of your own.
