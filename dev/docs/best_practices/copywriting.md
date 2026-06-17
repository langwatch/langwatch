# Copywriting: write for a first-time customer

Every piece of user-facing copy (button labels, descriptions, empty states,
toasts, tooltips, dialog text) is read by a customer, and most of the time by
someone seeing it for the FIRST time. Write for that person. Before shipping a
string, picture an actual new customer reading it and ask: do they understand
it, and do they care?

Two rules follow from that, and they are not optional.

## Never leak technical internals

Copy describes what the customer gets and why it matters, in their words, not
how the feature is built. Keep out of user-facing strings:

- internal module, table, route, or concept names (`scope-cascade fallback`,
  `/config refresh`, `workbenchState`, `foldState`);
- product concepts the reader does not have yet at this point in the flow;
- implementation detail that does not change what the customer should do.

If a term only makes sense to someone who has read our code, it does not belong
in the UI.

## Never leak history

The reader is seeing this fresh. They do not know what the feature used to be,
what it replaced, or what the other options are unless this screen already
taught them. Cut:

- "now", "no longer", "used to", "instead of", migration or changelog framing;
- comparisons against a sibling option the reader has no context for ("no
  workflow needed" only means something if you already know the workflow
  option exists and what it costs).

History lives in git and release notes, never in the product.

## Example

A "Custom (Code)" evaluator card:

```tsx
// Bad: "no workflow needed" compares against the other option a new user has
// not seen yet, and leaks that a workflow is otherwise involved.
description="Write a Python evaluator right here, no workflow needed"

// Good: says what they get, stands on its own.
description="Write a custom Python evaluator"
```

## Also

- No em dashes anywhere in copy; use a comma or colon (see the repo conventions).
- Prefer plain, concrete verbs ("Write", "Run", "Add") over vague ones.
- Pair icon buttons with a label when there is room (`icon-button-labels.md`).
