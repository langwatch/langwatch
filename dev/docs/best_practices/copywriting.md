# User-Facing Copy

Rules for any text a customer reads in the product: labels, descriptions,
tooltips, empty states, placeholders, toasts, and error messages. The UX
structure docs (`drawers.md`, `scope-selector-and-badges.md`,
`scoped-resources.md`) cover layout and components; this one covers the words.

## Never expose internal technical details

Customers care about what a feature does for them, never about how it is
built. Internal mechanics do not belong in copy:

| Wrong | Right |
|-------|-------|
| `Essential (fast, in-process: emails, phones, cards, IDs)` | `Essential (emails, phones, cards, IPs, national IDs)` |
| `Strict (adds names and locations, uses the analysis service)` | `Strict (adds names, locations, and more)` |
| `Saved. Cache invalidated.` | `Saved.` |

That includes process boundaries ("in-process", "runs a lambda"), internal
service names ("the analysis service"), infrastructure ("queued in Redis"),
and performance framing that only makes sense relative to our architecture
("fast" compared to what?).

One exception: naming a recognized third-party standard or model can build
trust ("Uses the Microsoft Presidio PII model"). Keep that in a tooltip, not
the main label.

## Short and concise

- Labels: a few words. Descriptions: one sentence.
- If a description needs a second sentence, the second sentence probably
  belongs in a tooltip.
- Don't restate the control ("Toggle to enable..."): say what it affects.

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
