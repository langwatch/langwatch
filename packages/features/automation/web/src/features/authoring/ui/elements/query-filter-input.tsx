/**
 * The raw trace-query editor, as this package can ship it.
 *
 * WHAT IT LOST, AND WHY. In `platform/app` this control reused the traces
 * view's suggestion engine AND its dropdown verbatim, so the fields, values,
 * grouping, icons and ranking matched the search bar exactly, and the footer
 * opened the syntax-help drawer. Four of those five pieces —
 * `SuggestionDropdown`, `SyntaxHelpDrawer`, `suggestionUI` and
 * `suggestionItems` — live in `platform/app/src/features/traces-v2`, which a
 * feature-web package may not import, and `@langwatch/trace-web` publishes only
 * the engine (`getSuggestionState`), not a surface that renders it. Copying
 * traces-v2's dropdown into this package was ruled out: it is another feature's
 * presentation and would drift the moment the search bar changes.
 *
 * So this is the plain editor: the same controlled textarea, writing the same
 * query string, with no autocomplete and no syntax drawer. Everything the query
 * can express still works, and the Subject facet still offers its example
 * chips and shows a live count of matching traces, which is what tells an
 * author whether what they typed is right.
 *
 * THIS IS THE ONE FEATURE LOSS OF THE AUTOMATIONS MOVE, and it is the same
 * shape as the me family's recent-traces placeholder. It closes when
 * `@langwatch/trace-web` publishes a search-suggestion surface. Recorded in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 */

import { Textarea } from "@chakra-ui/react";

export function QueryFilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Textarea
      value={value}
      placeholder={placeholder}
      fontFamily="mono"
      fontSize="sm"
      rows={2}
      autoresize
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
