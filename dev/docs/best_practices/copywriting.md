# User-facing copy: write for a first-time customer

Rules for any text a customer reads in the product: button labels,
descriptions, tooltips, empty states, placeholders, toasts, and error
messages. Most of the time it is read by someone seeing it for the FIRST
time, so write for that person: picture an actual new customer reading the
string and ask whether they understand it and whether they care. The UX
structure docs (`drawers.md`, `scope-selector-and-badges.md`,
`scoped-resources.md`) cover layout and components; this one covers the words.

Three rules follow, and they are not optional.

## Never expose internal technical details

Customers care about what a feature does for them, never about how it is
built. Keep out of user-facing strings:

- process boundaries ("in-process", "runs a lambda") and infrastructure
  ("queued in Redis");
- internal module, table, route, or concept names (`scope-cascade fallback`,
  `/config refresh`, `workbenchState`, `foldState`);
- internal service names ("the analysis service");
- performance framing that only makes sense relative to our architecture
  ("fast" compared to what?);
- product concepts the reader does not have yet at this point in the flow.

If a term only makes sense to someone who has read our code, it does not
belong in the UI.

| Wrong | Right |
|-------|-------|
| `Essential (fast, in-process: emails, phones, cards, IDs)` | `Essential (emails, phones, cards, IPs, national IDs)` |
| `Strict (adds names and locations, uses the analysis service)` | `Strict (adds names, locations, and more)` |
| `Saved. Cache invalidated.` | `Saved.` |

One exception: naming a recognized third-party standard or model can build
trust ("Uses the Microsoft Presidio PII model"). Keep that in a tooltip, not
the main label.

## Never leak history

The reader is seeing this fresh. They do not know what the feature used to be,
what it replaced, or what the other options are unless this screen already
taught them. Cut:

- "now", "no longer", "used to", and migration or changelog framing;
- comparisons against a sibling option the reader has no context for ("no
  workflow needed" only means something if you already know the workflow
  option exists and what it costs).

History lives in git and release notes, never in the product.

```tsx
// Bad: "no workflow needed" compares against an option a new user has not
// seen yet, and leaks that a workflow is otherwise involved.
description="Write a Python evaluator right here, no workflow needed"

// Good: says what they get, stands on its own.
description="Write a custom Python evaluator"
```

## Short and concise

- Labels: a few words. Descriptions: one sentence.
- If a description needs a second sentence, the second sentence probably
  belongs in a tooltip.
- Don't restate the control ("Toggle to enable..."): say what it affects.
- Prefer plain, concrete verbs ("Write", "Run", "Add") over vague ones.

## Details go in a tooltip, and must be complete

When copy summarizes a list (detected PII entities, supported providers,
matched key types), the label names the top few items and a help icon
(`HelpCircle` + `Tooltip`) carries the full list. Two rules for that list:

- It must be comprehensive: "which IDs?" is the first question a reader asks,
  so answer all of it.
- It must not drift from the code. Derive it from the implementation's
  exported constants, or pin it with a unit test against them (see
  `piiEntityLabels.ts` and its test).

Never list capabilities the code does not actually have.

## House style

- No em dashes anywhere. Use a comma, colon, or parentheses.
- Sentence case for labels and headings ("Add custom pattern", not "Add
  Custom Pattern").
- Plain words over jargon; no internal codenames, phase or iteration
  references, or author names.
- Pair icon buttons with a label when there is room (`icon-button-labels.md`).
