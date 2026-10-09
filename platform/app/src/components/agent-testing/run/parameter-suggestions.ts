/**
 * What a parameter line offers while it is typed.
 *
 * The line reads `name=value, name=value`. Before the "=" of a token the
 * field is in key mode and lists the declared parameters; after it the field
 * is in value mode and lists what the parameter accepts. The suggestions are
 * a help and not a gate: free text always commits, and the server refuses a
 * value it cannot accept when the run starts.
 *
 * Everything here is pure, so the rules can be read and tested on their own.
 * The token state machine is the one the traces search bar uses, with "=" and
 * "," as its separators.
 *
 * @see specs/features/agent-testing/parameter-autocomplete.feature
 */

import type {
  DeclaredParameter,
  ParameterSource,
} from "~/components/suites/useRunSuite";
import {
  getSuggestionState,
  PARAMETER_LINE_GRAMMAR,
  type SuggestionState,
} from "~/features/traces-v2/components/SearchBar/getSuggestionState";
import { rankByMatch } from "~/features/traces-v2/components/SearchBar/suggestionItems";
import type { SuggestionRow } from "~/features/traces-v2/components/SearchBar/suggestionUI";
import { displayTypedValue } from "~/utils/jsonValueText";
import { parseParameterLine } from "./parameter-line";

/** What the line shows while it is empty and nothing is declared. */
export const PARAMETER_LINE_PLACEHOLDER = "plan=free, locale=de";

/** One row of the list under a parameter line. */
export type ParameterSuggestionRow = SuggestionRow & {
  kind: "key" | "value";
  /** What the parameter is for, on a key row. */
  description?: string;
  /** The declared default as text, on a key row that has one. */
  defaultText?: string;
  /** Where the parameter is declared, on a key row. */
  source?: ParameterSource;
  /** The agent that declares it, on a key row from an agent. */
  agentLabel?: string;
  /** True for the value row that echoes what was typed. */
  isTyped?: boolean;
};

/** The state of the token under the cursor of a parameter line. */
export function parameterSuggestionState({
  text,
  cursor,
}: {
  text: string;
  cursor: number;
}): SuggestionState {
  return getSuggestionState(text, cursor, PARAMETER_LINE_GRAMMAR);
}

/**
 * What one field edits: a whole `name=value, name=value` line, the name of
 * one row, or the value of one row whose name is fixed.
 */
export type ParameterFieldMode =
  | { kind: "line" }
  | { kind: "name" }
  | { kind: "value"; name: string };

/**
 * The suggestion state of a field, by what it edits.
 *
 * A name field is always in key mode over its whole text, and a value field
 * always in value mode for its row's name, so the list opens on focus and the
 * accepted entry replaces the whole text.
 */
export function parameterFieldState({
  mode,
  text,
  cursor,
}: {
  mode: ParameterFieldMode;
  text: string;
  cursor: number;
}): SuggestionState {
  if (mode.kind === "line") return parameterSuggestionState({ text, cursor });
  const query = text.slice(0, cursor);
  if (mode.kind === "name") {
    return { open: true, mode: "field", query, tokenStart: 0 };
  }
  if (mode.name.trim() === "") return { open: false };
  return { open: true, mode: "value", field: mode.name, query, tokenStart: 0 };
}

/** The text of a field after a row is accepted, by what the field edits. */
export function acceptParameterField({
  mode,
  text,
  cursor,
  state,
  row,
}: {
  mode: ParameterFieldMode;
  text: string;
  cursor: number;
  state: Extract<SuggestionState, { open: true }>;
  row: ParameterSuggestionRow;
}): { text: string; cursor: number; reopens: boolean } {
  if (mode.kind === "line") {
    return acceptParameterSuggestion({ text, cursor, state, row });
  }
  return { text: row.value, cursor: row.value.length, reopens: false };
}

/** A refusal the server addressed to one parameter by name. */
export type ParameterFieldError = {
  name: string;
  /** The value that was refused, when the refusal names it. */
  value?: unknown;
  /** What the person reads under the field. */
  message: string;
};

/**
 * Whether the pair `name=raw` is the one a refusal names.
 *
 * The refused value arrives typed, so the raw text matches it as it was
 * written or as its JSON form: "007" and "\"007\"" both spell the text "007".
 */
function pairIsRefused({
  name,
  raw,
  error,
}: {
  name: string;
  raw: string;
  error: ParameterFieldError;
}): boolean {
  if (name !== error.name) return false;
  if (error.value === undefined) return true;
  return raw === String(error.value) || raw === JSON.stringify(error.value);
}

/** The message that belongs on a line: set when the line holds the refused pair. */
export function errorOnLine({
  line,
  error,
}: {
  line: string;
  error: ParameterFieldError | null;
}): string | undefined {
  if (!error) return undefined;
  const holds = parseParameterLine(line).some(([name, raw]) =>
    pairIsRefused({ name, raw, error }),
  );
  return holds ? error.message : undefined;
}

/** The message that belongs on one row: set when the row is the refused pair. */
export function errorOnRow({
  name,
  value,
  error,
}: {
  name: string;
  value: string;
  error: ParameterFieldError | null;
}): string | undefined {
  if (!error) return undefined;
  return pairIsRefused({ name: name.trim(), raw: value.trim(), error })
    ? error.message
    : undefined;
}

/** The key rows: every declared parameter that can ride on the line. */
export function keySuggestions({
  definitions,
  query,
}: {
  definitions: readonly DeclaredParameter[];
  query: string;
}): ParameterSuggestionRow[] {
  const candidates = definitions
    .filter((definition) => definition.secret !== true)
    .map((definition) => ({
      keys: [definition.name],
      row: {
        kind: "key" as const,
        value: definition.name,
        label: definition.name,
        field: definition.name,
        group: null,
        description: definition.description,
        defaultText:
          definition.defaultValue === undefined
            ? undefined
            : displayTypedValue({
                value: definition.defaultValue,
                type: definition.type,
              }),
        source: definition.source,
        agentLabel: definition.agentLabel,
      } satisfies ParameterSuggestionRow,
    }));
  return rankByMatch(candidates, query, null).map((entry) => entry.row);
}

/**
 * The value rows of one parameter: its options when the list is closed, or
 * else its default and the text typed so far.
 */
export function valueSuggestions({
  definition,
  query,
}: {
  definition: DeclaredParameter | undefined;
  query: string;
}): ParameterSuggestionRow[] {
  const asRow = ({
    text,
    isTyped = false,
  }: {
    text: string;
    isTyped?: boolean;
  }): ParameterSuggestionRow => ({
    kind: "value",
    value: text,
    label: text,
    field: definition?.name ?? "",
    group: null,
    ...(isTyped ? { isTyped } : {}),
  });

  if (definition?.options && definition.options.length > 0) {
    const candidates = definition.options.map((option) => {
      const text = displayTypedValue({ value: option, type: definition.type });
      return { keys: [text], row: asRow({ text }) };
    });
    return rankByMatch(candidates, query, null).map((entry) => entry.row);
  }

  const rows: ParameterSuggestionRow[] = [];
  if (definition?.defaultValue !== undefined) {
    rows.push(
      asRow({
        text: displayTypedValue({
          value: definition.defaultValue,
          type: definition.type,
        }),
      }),
    );
  }
  const typed = query.trim();
  if (typed !== "" && !rows.some((row) => row.value === typed)) {
    rows.push(asRow({ text: typed, isTyped: true }));
  }
  return rows;
}

/** The rows for the token under the cursor, or none while the list is closed. */
export function parameterSuggestions({
  state,
  definitions,
}: {
  state: SuggestionState;
  definitions: readonly DeclaredParameter[];
}): ParameterSuggestionRow[] {
  if (!state.open) return [];
  if (state.mode === "field") {
    return keySuggestions({ definitions, query: state.query });
  }
  return valueSuggestions({
    definition: definitions.find((entry) => entry.name === state.field),
    query: state.query,
  });
}

/**
 * The line after a row is accepted.
 *
 * A key replaces the token with `name=` and the list reopens on the values.
 * A value replaces the token with `name=value` and the list closes. The whole
 * token goes, up to the comma that ends it, so a caret in the middle of
 * `model=gp|t` leaves no "t" behind; a pair further along the line stays.
 */
export function acceptParameterSuggestion({
  text,
  cursor,
  state,
  row,
}: {
  text: string;
  cursor: number;
  state: Extract<SuggestionState, { open: true }>;
  row: ParameterSuggestionRow;
}): { text: string; cursor: number; reopens: boolean } {
  const replacement =
    state.mode === "field" ? `${row.value}=` : `${state.field}=${row.value}`;
  const before = text.slice(0, state.tokenStart);
  const tokenEnd = text.indexOf(",", cursor);
  const after = tokenEnd === -1 ? "" : text.slice(tokenEnd);
  return {
    text: `${before}${replacement}${after}`,
    cursor: before.length + replacement.length,
    reopens: state.mode === "field",
  };
}

/**
 * What an empty line shows: the first declared parameter with its default,
 * `model=gpt-5-mini`, so the example is one the run will take. A parameter
 * with no default shows its first option instead, or its name alone.
 */
export function parameterPlaceholder(
  definitions: readonly DeclaredParameter[],
): string {
  const first = definitions.find((definition) => definition.secret !== true);
  if (!first) return PARAMETER_LINE_PLACEHOLDER;
  const value =
    first.defaultValue !== undefined
      ? first.defaultValue
      : (first.options?.[0] ?? "");
  return `${first.name}=${displayTypedValue({ value, type: first.type })}`;
}
