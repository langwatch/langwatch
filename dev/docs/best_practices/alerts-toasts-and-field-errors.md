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
card material, a hairline in its status colour and a status-coloured icon, with
the text in the ordinary foreground colours. The status never fills the box.

| `variant`          | Looks like                                                | Use it for                                                 |
| ------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| `subtle` (default) | Card material, status hairline.                           | Almost everything.                                         |
| `surface`          | Card material, neutral hairline, status edge on the left. | A page-level notice or empty state that heads a page.      |
| `outline`          | No ground of its own, status hairline.                    | An alert on a surface that paints its own ground (glass).  |
| `solid`            | Filled.                                                   | Rare: the one thing on the screen that must not be missed. |

`status` is one of `info`, `success`, `warning`, `error`, `neutral`. Set the
status, not a `colorPalette`; a palette alone is for a brand accent that is not
a status (the onboarding nudges). `size="sm"` is the compact alert for drawers,
popovers and table cells.

Do not restyle an alert at the call site. `bg`, `borderColor`, `color`,
`borderRadius`, `padding`, `opacity`, a hand-drawn left border, or a
`fontSize` on its title or description all fight the recipe, and one screen
drifts from the rest. Margins, width and position are layout and belong to the
call site. The workshop shows every status in every variant in both colour
modes: `Primitives/Alert` in `pnpm --filter @langwatch/design-system storybook`.
