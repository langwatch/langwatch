/**
 * Named scalar values that travel beside the SQL.
 *
 * The statement is never rewritten to carry them: a placeholder stays a
 * placeholder and the values ride in their own field, which is what keeps the
 * text that runs identical to the text that was written. The only check here is
 * the shape a value has to have to be sendable at all.
 *
 * When the backend refuses a submission for missing parameters, the names it
 * gave are listed here rather than in a message elsewhere on the page: the
 * member fixes it in this form, so this is where it has to be said.
 *
 * @see specs/analytics/lwql-workbench.feature
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";

import {
  QueryParametersPanel,
  reservedPrefixProblem,
  type QueryParameterRowVM,
} from "~/components/analytics/QueryParametersPanel";
import { RESERVED_PARAMETERS } from "~/server/analytics/dashboardWidgetDefinition";

import type { LangWatchQLParameterValue } from "../logic/lwqlRequestState";

/** What a row's text means. The four shapes the API accepts. */
type ParameterKind = "text" | "number" | "boolean" | "null";

/**
 * The type picker's own vocabulary (shared with the "variables" visual
 * language — `~/prompts/components/ui/VariableTypeIcon`), and the mapping
 * back to a `ParameterKind`. `text` displays as `string` so the icon/label
 * line up with the rest of the product without adding a case to that shared
 * module for this editor's own naming.
 */
const TYPE_OPTIONS = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "null", label: "Null" },
];

function kindToDisplayType(kind: ParameterKind): string {
  return kind === "text" ? "string" : kind;
}

function displayTypeToKind(type: string): ParameterKind {
  return type === "string" ? "text" : (type as ParameterKind);
}

interface ParameterRow {
  /** Stable across renames, so a row keeps its identity while being typed. */
  readonly id: string;
  readonly name: string;
  readonly kind: ParameterKind;
  readonly text: string;
}

let nextRowId = 0;
function newRow(): ParameterRow {
  nextRowId += 1;
  return { id: `parameter-${nextRowId}`, name: "", kind: "text", text: "" };
}

/**
 * A row's value, or `undefined` when its text cannot be one.
 *
 * The whole of the local validation: a number has to be a number. Everything
 * else about the value, including whether the statement wanted it at all, is
 * the backend's to decide.
 */
function valueOf(row: ParameterRow): LangWatchQLParameterValue | undefined {
  switch (row.kind) {
    case "text":
      return row.text;
    case "number": {
      if (row.text.trim().length === 0) return undefined;
      const parsed = Number(row.text);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case "boolean":
      return row.text === "true";
    case "null":
      return null;
  }
}

function recordOf(
  rows: readonly ParameterRow[],
): Record<string, LangWatchQLParameterValue> {
  const record: Record<string, LangWatchQLParameterValue> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name.length === 0) continue;
    const value = valueOf(row);
    if (value === undefined) continue;
    record[name] = value;
  }
  return record;
}

/** Whether the member has put anything in this row's value field. */
function valueTyped(row: ParameterRow): boolean {
  return row.kind !== "null" && row.text.trim().length > 0;
}

/**
 * What stops a row being sent, or `undefined` when it can be — including a row
 * still empty, which is not a parameter yet rather than a broken one.
 *
 * These are exactly the rows {@link recordOf} drops or collapses. Saying so on
 * the row and holding Run back is what keeps a dropped row from becoming a
 * round-trip that comes back naming a parameter the member can see they filled
 * in.
 *
 * A repeated name needs the whole set to see: {@link recordOf} keys by name, so
 * two rows called `limit` leave one entry and the later row silently wins. Read
 * one row at a time that is invisible — both rows look complete.
 */
function rowProblem({
  row,
  rows,
}: {
  row: ParameterRow;
  rows: readonly ParameterRow[];
}): string | undefined {
  const name = row.name.trim();
  if (name.length === 0) {
    return valueTyped(row) ? "Name this parameter." : undefined;
  }
  if (rows.filter((other) => other.name.trim() === name).length > 1) {
    return "Use this name once.";
  }
  const reservedProblem = reservedPrefixProblem(name);
  if (reservedProblem) return reservedProblem;
  return valueOf(row) === undefined ? "Enter a number." : undefined;
}

/** A refusal about named parameters, said where those parameters are edited. */
function ParameterAlert({
  title,
  names,
}: {
  title: string;
  names: readonly string[];
}) {
  if (names.length === 0) return null;

  return (
    <Box
      role="alert"
      borderWidth="1px"
      borderColor="red.solid"
      borderRadius="8px"
      paddingX={3}
      paddingY={2}
    >
      <Text fontSize="13px" fontWeight="600">
        {title}
      </Text>
      <Text fontSize="12.5px" color="fg.muted">
        {names.join(", ")}
      </Text>
    </Box>
  );
}

/** Builds this row's view model for the shared {@link QueryParametersPanel}. */
function rowVM({
  row,
  rows,
  onPatch,
  onRemove,
}: {
  row: ParameterRow;
  /** Every row, so a name repeated across rows can be reported on both. */
  rows: readonly ParameterRow[];
  onPatch: (changes: Partial<Omit<ParameterRow, "id">>) => void;
  onRemove: () => void;
}): QueryParameterRowVM {
  return {
    id: row.id,
    name: row.name,
    onNameChange: (name) => onPatch({ name }),
    type: kindToDisplayType(row.kind),
    onTypeChange: (type) => onPatch({ kind: displayTypeToKind(type) }),
    value: row.text,
    onValueChange: (text) => onPatch({ text }),
    valueKind:
      row.kind === "boolean"
        ? "boolean"
        : row.kind === "null"
          ? "disabled"
          : "input",
    inputType: row.kind === "number" ? "number" : "text",
    onRemove,
    problem: rowProblem({ row, rows }),
  };
}

/** Everything one edit of the form settles, reported together. */
export interface LangWatchQLParametersChange {
  readonly parameters: Readonly<Record<string, LangWatchQLParameterValue>>;
  /** False while any row carries something the form cannot send. */
  readonly sendable: boolean;
}

export interface LangWatchQLParametersEditorProps {
  onChange: (change: LangWatchQLParametersChange) => void;
  /** Names the last submission declared and did not supply. */
  missingParameters: readonly string[];
  /**
   * Names the last submission sent that the surface owns —
   * `dashboard_context_period_start` and `dashboard_context_period_end`,
   * which are set by the time window rather than here.
   */
  reservedParameters: readonly string[];
  /**
   * Values to start from — a saved chart's, when one has been opened.
   *
   * Read once, at mount. The workbench remounts this form (by key) when it
   * opens a chart, which is what makes "opening restores the values" true
   * without this form having to arbitrate between a saved value and one the
   * member is halfway through typing.
   */
  initialParameters?: Readonly<Record<string, LangWatchQLParameterValue>>;
  /**
   * Current live values for the reserved parameters, keyed by name — the same
   * `dashboard_context_period_start`/`dashboard_context_period_end`/
   * `dashboard_context_granularity_seconds` the time window and granularity
   * picker above already show, formatted the way the
   * statement receives them. Shown as read-only rows above the author's own,
   * the way the dashboard widget editor already does, so a member can see
   * what those names resolve to without triggering a refusal first.
   */
  builtinValues?: Readonly<Record<string, string>>;
}

function kindOf(value: LangWatchQLParameterValue): ParameterKind {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

/** Turns saved values back into rows, recovering the kind from each value. */
function rowsOf(
  parameters: Readonly<Record<string, LangWatchQLParameterValue>>,
): readonly ParameterRow[] {
  return Object.entries(parameters).map(([name, value]) => ({
    id: `param-${nextRowId++}`,
    name,
    kind: kindOf(value),
    text: value === null ? "" : String(value),
  }));
}

export function LangWatchQLParametersEditor({
  onChange,
  missingParameters,
  reservedParameters,
  initialParameters,
  builtinValues = {},
}: LangWatchQLParametersEditorProps) {
  const [rows, setRows] = useState<readonly ParameterRow[]>(() =>
    initialParameters ? rowsOf(initialParameters) : [],
  );
  const [expanded, setExpanded] = useState(false);

  // A refusal that names parameters is answered in this form, so the form has
  // to be open to answer it.
  const isOpen =
    expanded || missingParameters.length > 0 || reservedParameters.length > 0;

  const update = useCallback(
    (next: readonly ParameterRow[]) => {
      setRows(next);
      onChange({
        parameters: recordOf(next),
        sendable: next.every(
          (row) => rowProblem({ row, rows: next }) === undefined,
        ),
      });
    },
    [onChange],
  );

  const patch = useCallback(
    (id: string, changes: Partial<Omit<ParameterRow, "id">>) => {
      update(rows.map((row) => (row.id === id ? { ...row, ...changes } : row)));
    },
    [rows, update],
  );

  return (
    <VStack align="stretch" gap={2} width="full" data-testid="lwql-parameters">
      <HStack gap={2}>
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={isOpen}
          // Toggles what is on screen, not a flag behind it: while a refusal
          // holds the form open, tracking `expanded` separately left it in an
          // arbitrary state that decided whether the form closed when the
          // refusal cleared.
          onClick={() => setExpanded(!isOpen)}
        >
          <Box aria-hidden="true" display="flex">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </Box>
          Parameters
        </Button>
        {rows.length > 0 && (
          <Text fontSize="12px" color="fg.muted">
            {rows.length === 1 ? "1 parameter" : `${rows.length} parameters`}
          </Text>
        )}
      </HStack>

      <ParameterAlert
        title="Give these parameters a value"
        names={missingParameters}
      />
      <ParameterAlert
        title="Remove these — the time window above sets them"
        names={reservedParameters}
      />

      {isOpen && (
        <QueryParametersPanel
          reserved={RESERVED_PARAMETERS}
          dashboardContextValues={builtinValues}
          typeOptions={TYPE_OPTIONS}
          rows={rows.map((row) =>
            rowVM({
              row,
              rows,
              onPatch: (changes) => patch(row.id, changes),
              onRemove: () =>
                update(rows.filter((other) => other.id !== row.id)),
            }),
          )}
          onAdd={() => update([...rows, newRow()])}
        />
      )}
    </VStack>
  );
}
