# Icon buttons: pair them with a text label

When there is room, a button shows its icon AND a text label. Icon-only buttons
are hard to find and easy to misread: people scan a toolbar or header and skip
the bare glyph, or hover every icon hunting for the one they want. A two-word
label removes that guesswork at almost no cost in space.

Default to `<Button><Icon /> Label</Button>`. Reach for an icon-only control
only when the action is universal enough to be unambiguous AND space is genuinely
tight (see the exceptions below).

## The rule

```tsx
// Prefer: icon + label. The visible text is the accessible name, so no
// aria-label is needed.
<Button size="xs" variant="ghost">
  <Settings2 size={14} /> Edit columns
</Button>

// Avoid when there is space: icon-only. Forces an aria-label and still leaves
// users guessing what the glyph does.
<IconButton size="xs" variant="ghost" aria-label="Edit dataset columns">
  <Settings2 size={14} />
</IconButton>
```

- Keep the icon for fast recognition; add the label for findability. The icon
  sits before the text.
- A labeled button does not need an `aria-label`: its visible text already names
  it. Adding one risks a WCAG "label in name" mismatch (the spoken name should
  contain the visible text).
- Match the surrounding controls' `size` and `variant` so the labeled button
  reads as part of the set, not a heavier element bolted on.

## When icon-only is fine

Some glyphs are universal enough that a label adds noise, and some spots have no
room. Icon-only is the right call for:

- **Undo / redo** - the curved arrows are universally understood.
- **Close (`X`)** on dialogs and drawers.
- **The row-actions overflow menu** (`MoreVertical`) in a dense table row. See
  `row-actions-overflow-menu.md`; that pattern is intentionally icon-only and
  carries an `aria-label`.
- **Drag handles**, expand/collapse chevrons, and similar affordances whose
  meaning comes from position and context.

Every icon-only button MUST carry an `aria-label`. If you find yourself adding a
tooltip just so people can tell what an icon-only button does, that is the signal
to give it a visible label instead.

## Related

- `feature-icons.md` - which icon represents which feature or entity.
- `row-actions-overflow-menu.md` - the sanctioned icon-only per-row menu.
