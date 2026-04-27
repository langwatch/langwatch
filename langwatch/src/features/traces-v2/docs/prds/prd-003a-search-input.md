# PRD-003a: Search Bar Input — Keyboard & Suggestion Model

Parent: [PRD-003: Search & Filter System](./prd-003-search.md)
Status: DRAFT (for review)
Date: 2026-04-27

## Why this addendum exists

PRD-003 specifies *what* the search bar should do (syntax, autocomplete, two-way sync). It does **not** specify *how the keyboard model behaves around the suggestion dropdown*. The current `SearchBar.tsx` implementation has been hard to use because the Enter key, dropdown selection, and free-text typing collide in ways the original spec never resolved.

This document defines the input-level behaviour precisely so the rebuild has a single, testable contract.

## Bugs in current behaviour

Reproduced in `langwatch/src/features/traces-v2/components/SearchBar/SearchBar.tsx`:

1. **Enter never reliably submits** — when the dropdown has any items (almost always), Enter is consumed by the suggestion plugin and inserts whatever is highlighted. There is no way to submit "exactly what I typed" except to dismiss the dropdown first, which can't be done without losing focus.
2. **Selecting a value-suggestion auto-submits the whole query** — `command()` in `SearchBar.tsx:148` calls `onApply()` when the inserted suggestion has no trailing colon. This robs the user of the chance to add `AND …`.
3. **Dropdown opens with no input intent** — the suggestion plugin returns an empty match for empty editor / cursor-at-start (`SearchBar.tsx:124`), so the dropdown can pop unbidden.
4. **Free-text typing pollutes suggestions** — `buildSuggestions` ranks any field whose name contains the typed substring, so typing `m` to start `model` ends up showing `model:gpt-4o`, `model:claude`, etc., even when the user is mid-sentence of free text.
5. **Tab and Enter are identical inside the dropdown** — both accept the highlighted suggestion (`SearchBar.tsx:247`). There is no way to tab-complete-only without committing.
6. **Escape always blurs the editor** — there is no "dismiss dropdown but keep cursor" state.
7. **No tests** — zero unit or integration tests on the component, the suggestion bridge, or the highlight extension.

## Design principles

1. **Dropdown open ↔ cursor inside an active token.** The dropdown is open *if and only if* the cursor sits inside a token of shape `@partial`, `@field:`, or `@field:partial` — meaning no whitespace between the `@` and the cursor. Whitespace closes it. Period.
2. **Enter is contextual, never ambiguous.** Dropdown open → accept highlighted suggestion. Dropdown closed → submit. The two states are visually obvious so the user always knows which Enter they're getting.
3. **Accepting a value inserts a trailing space.** This pushes the cursor past the token, which closes the dropdown by rule 1. So the natural sequence `@status:` → Enter → Enter is unambiguous: pick first value, then submit.
4. **Accepting a field reopens the dropdown in value mode.** `@` → Enter on `model` → input becomes `@model:` with cursor inside the now-empty value position → value-mode dropdown opens immediately. So `@` → Enter → Enter → Enter = "first field, first value, submit".
5. **Blur always submits.** Clicking out, tabbing out, or focus moving anywhere else commits the current text. Avoids the "I typed but forgot to press Enter" trap when interacting with the sidebar.
6. **Escape is hierarchical.** Dropdown open → close it (cursor stays). Dropdown closed → blur editor (which submits).
7. **Free-text mode shows no dropdown.** If the cursor isn't inside an `@`-token by rule 1, suggestions never appear.

## Keyboard contract

| Context | Key | Action |
|---|---|---|
| Dropdown closed, focused | `Enter` | Submit query as typed |
| Dropdown closed, focused | `Escape` | Blur editor (which also submits) |
| Dropdown closed, focused | `Tab` | Default tab — moves focus out, blur submits |
| Dropdown open | `Enter` | Accept highlighted suggestion. Field accept → reopens in value mode. Value accept → inserts trailing space → dropdown closes. |
| Dropdown open | `Tab` | Same as Enter (accept). |
| Dropdown open | `Escape` | Close dropdown only; cursor stays; no submit |
| Dropdown open | `↑` / `↓` | Move highlight (wraps at ends) |
| Dropdown open | Click suggestion | Same as Enter (accept) |
| Dropdown open | Type ` ` (space) | Insert space; cursor moves past token; dropdown closes per rule 1 |
| Anywhere on page | `/` | Focus editor (only when not already in another input/contenteditable) |
| Editor (any state) | Blur (click out, focus elsewhere) | Submit query as typed |

## Suggestion-open rules

The dropdown is open if and only if the cursor is inside an active token:

1. **Field-name mode:** cursor is after `@` with no whitespace between `@` and cursor, and no `:` between them either. Query string = the chars after `@`.
2. **Value mode:** cursor is after `@field:` with no whitespace between `:` and cursor. Query string = the chars after `:`.

Token boundaries:
- A token starts at `@` (preceded by start-of-input, whitespace, or `(`).
- A token ends at the first whitespace, `)`, or end-of-input.
- If the cursor is at any position inside the token bounds (per rules 1 or 2), dropdown is open.
- Otherwise dropdown is closed.

No `Ctrl+Space` force-show in v1 — keep the model simple. Add later if users ask.

## Suggestion content rules

- **Field-name mode** (after `@`): list `FIELD_NAMES` filtered by the partial typed after `@`. No values mixed in.
- **Value mode** (after `@field:`): list `FIELD_VALUES[field]` filtered by the partial typed after `:`. If the field has no known values, show "Type a value" hint (non-selectable).
- **Order:** exact-prefix matches first, then substring matches, then the rest. Cap at 10.
- **Free-text typing** (no `@` near cursor): no dropdown. Period.

## Suggestion-accept rules

When a suggestion is accepted (Enter / Tab / click):

| Suggestion shape | Replaces token with | Cursor lands | Dropdown after |
|---|---|---|---|
| `field` (field-name mode) | `@field:` | After the `:` | Open in value mode (immediately) |
| `value` (value mode) | `@field:value ` (trailing space) | After the space | Closed (cursor moved past token) |
| `field` with no known values | `@field:` | After the `:` | Open but empty — shows "Type a value" hint, non-blocking |

Accepting a suggestion replaces only the active token, not the surrounding query. Other clauses (`AND @status:error AND ...`) are preserved verbatim.

Accepting a suggestion does **not** submit the query — submission requires Enter (with dropdown closed) or blur.

## Submit rules

A submit calls `applyQueryText(editor.getText().trim())` and is triggered by:

- `Enter` while dropdown is closed.
- Editor blur (any cause: click out, Tab out, programmatic focus change).
- `Escape` (which blurs).

Submit is **idempotent and cheap**: if the text hasn't changed since the last submit, the store no-ops. So multiple triggers (Enter then blur) don't duplicate work.

- Empty input: clears the AST (equivalent to Clear).
- Parse error: `parseError` is set on the store; the search-bar shows red outline + inline message; sidebar retains last-valid state (per existing PRD-003). The user can refocus and fix the syntax — blur-submitting an invalid query does not destroy their text, only marks it as a parse error.

## Free-text submission preserves quoting

If the user types `refund policy` (unquoted, no `@`) and presses Enter:

- The parser treats it as an `ImplicitField` token (liqe behaviour).
- The serialised form may quote multi-word free text: `"refund policy"`.
- After submit, the input rewrites to the serialised form so the user sees what was actually parsed.

This already works in `safeParseAndSerialize` in the store. The contract is making it explicit.

## Component split

To keep the rebuild testable, split `SearchBar.tsx` into the following units. Pure-logic files carry the bulk of the test coverage; the React component is a thin shell.

```
SearchBar/
  SearchBar.tsx              -- Composition + Chakra layout + TipTap wiring. Minimal logic.
  getSuggestionState.ts      -- Pure: (text, cursorPos) -> SuggestionState
                                Decides whether the dropdown is open and what mode/query.
  handleKey.ts               -- Pure: (editorContext, key) -> KeyAction
                                Decides what each keystroke should do given the current
                                editor + dropdown state. Encodes the keyboard contract.
  suggestionExtension.ts     -- TipTap/ProseMirror plugin. Bridges editor events to React,
                                translates KeyActions to editor commands.
  filterHighlight.ts         -- (existing) decoration extension. No change to behaviour.
  index.ts
```

**Why two pure functions?** ProseMirror is not reliably testable in jsdom (no other test in this codebase touches TipTap). The keyboard contract is too important to leave to a fragile end-to-end test, so we pull the decisions into pure functions and exhaustively unit-test them. The integration test then only smoke-tests the wiring (mount → type → dropdown visible → click → store updated).

## Test plan

### Unit tests — `useSuggestionModel`

Pure function: `(text: string, cursorPos: number) → SuggestionState`.

- Empty text, cursor at 0 → closed.
- `"@"`, cursor at 1 → open, field-name mode, query="".
- `"@mo"`, cursor at 3 → open, field-name mode, query="mo".
- `"@mo"`, cursor at 1 (between `@` and `m`) → open, field-name mode, query="" (chars before cursor only).
- `"@model:"`, cursor at 7 → open, value mode, field="model", query="".
- `"@model:gpt"`, cursor at 10 → open, value mode, field="model", query="gpt".
- `"@model:gpt-4o "`, cursor at 14 (after the space) → closed.
- `"refund"`, cursor at 6 → closed (no `@` in token).
- `"@status:error AND @mo"`, cursor at 21 → open, field-name mode, query="mo".
- `"@status:error AND @mo"`, cursor at 13 (after first `error`, before space) → open, value mode, field="status", query="error".
- `"@status:error AND @mo"`, cursor at 14 (after the space) → closed.
- `"(@status:error)"`, cursor at 14 (just before `)`) → open, value mode, field="status", query="error".
- `"@status:\"refund policy\""`, cursor inside the quotes → closed (quoted values aren't autocompleted).

### Unit tests — `handleKey`

Pure function: `(ctx: EditorContext, key: string) → KeyAction`.

`EditorContext` carries `text`, `cursorPos`, the current `SuggestionState` (from `getSuggestionState`), and the highlighted suggestion text (or `null`). `KeyAction` is one of: `noop`, `submit`, `blur`, `close-dropdown`, `navigate`, `accept`.

**Enter:**
- Dropdown closed → `submit` with current text.
- Dropdown open in field mode, highlight present → `accept` with replacement `@<field>:`, `reopenInValueMode: true`.
- Dropdown open in value mode, highlight present → `accept` with replacement `@<field>:<value> ` (trailing space), `reopenInValueMode: false`.
- Dropdown open, no highlight (empty list) → `submit`.

**Tab:** identical to Enter.

**Escape:**
- Dropdown open → `close-dropdown`.
- Dropdown closed → `blur`.

**ArrowUp / ArrowDown:**
- Dropdown open → `navigate`.
- Dropdown closed → `noop`.

**Space:**
- Returns `noop` so the editor inserts the space normally; the resulting text re-runs `getSuggestionState`, which closes the dropdown.

**All other keys:** `noop`.

### Integration tests — `SearchBar` component (smoke)

Driven via `@testing-library/react` + `@testing-library/user-event` against a real editor mounted in jsdom. Scope is intentionally narrow — exhaustive contract testing lives in the pure-function unit tests above.

- Mount renders an empty editor with the placeholder visible.
- Typing `@` opens the dropdown (verifies wiring of `getSuggestionState` to the dropdown UI).
- Clicking a suggestion item updates the editor text (verifies wiring of `handleKey` accept-action to the editor).
- Pressing Enter on a non-empty input calls `applyQueryText` on the store.
- Blurring the editor with non-empty text calls `applyQueryText` on the store.
- `/` keypress on document focuses the editor.
- Empty Enter calls `applyQueryText("")`.

We do NOT integration-test:
- Each keyboard contract row (covered by `handleKey` unit tests).
- Each cursor-context boundary (covered by `getSuggestionState` unit tests).
- TipTap-internal selection/range handling (third-party, not our concern).

### Visual / regression
- Filter-token highlight unchanged: render `@status:error AND NOT @model:gpt-4o` → blue chip on first, red chip on second.

## Out of scope for this addendum

- Cross-facet OR warning badge (already in PRD-003 §Edge Cases — currently working).
- Sidebar projection of AST (covered by separate FilterSidebar tests).
- Time range selector.
- AI/NLP query parsing (Phase 3).

## Implementation sequence

1. Land this PRD addendum.
2. Add new scenarios to `specs/traces-v2/search.feature` mirroring the keyboard contract.
3. Write `getSuggestionState.unit.test.ts` — red.
4. Implement `getSuggestionState.ts` — green.
5. Write `handleKey.unit.test.ts` — red.
6. Implement `handleKey.ts` — green.
7. Write `SearchBar.integration.test.tsx` (smoke only) — red.
8. Refactor `SearchBar.tsx` into the new file split; reimplement the suggestion extension to delegate to `handleKey` — green.
9. Manual verification in browser via `browser-pair` against `make dev`.
