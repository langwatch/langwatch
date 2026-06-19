# Inline fix-it links

Links that send the user from a working context (a trace, a drawer, an inline
notice, a tooltip) to a settings or configuration page to fix or change
something open in a new tab.

## The rule

Any link rendered outside the settings area that points into settings so the
user can act on what they are looking at opens in a new tab:

```tsx
<NextLink
  href="/settings/data-privacy"
  target="_blank"
  rel="noopener noreferrer"
>
  Open privacy settings
</NextLink>
```

Always pair `target="_blank"` with `rel="noopener noreferrer"`.

## Why

The user is in the middle of something: reading a trace, debugging a span,
reviewing a run. A privacy notice, an empty state, or a tooltip points them at
the setting that explains or controls what they see. Navigating there in the
same tab throws away the context they were working in, and the back button does
not reliably restore drawer or scroll state. Opening in a new tab lets them
change the setting and come back to exactly where they were.

## What this covers

- Inline notices ("the input was dropped by a privacy policy") that link to the
  controlling settings page.
- Tooltip and marker links that explain a state and offer to change it.
- Empty states that say "configure something to see data here".
- Any other go-fix-this link that starts from a surface which is not settings.

## What this does not cover

- The settings navigation itself: sidebar, breadcrumbs, menu links. Moving
  between settings pages stays in the same tab.
- Primary navigation and in-flow actions that are meant to take the user
  somewhere, not send them on a side errand.

## Where this lives today

`ContentPrivacyMarkers`, `RedactedField`, and `PrivacyDroppedNotice` all link to
`/settings/data-privacy` this way. `PrivacyDroppedNotice` renders its link
directly, so its test asserts `target="_blank"`. The other two render the link
inside a tooltip that only mounts when open, so they rely on the shared pattern
here rather than a separate DOM assertion.
