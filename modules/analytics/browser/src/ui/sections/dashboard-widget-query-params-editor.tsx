/**
 * Editor for one query's declared parameters, checked against a live
 * `LW.query` call by `validateDashboardWidgetQueryParams`. Each row is a
 * name, JS type, and optional default — the Run button's only value source.
 */

import {
  type DashboardWidgetQuery,
  type DashboardWidgetQueryParameterDeclaration,
  RESERVED_PARAMETERS,
} from "../../model/dashboard-widget-definition.ts";
import {
  type QueryParameterRowVM,
  QueryParametersPanel,
  reservedPrefixProblem,
} from "./query-parameters-panel.tsx";

const TYPE_OPTIONS = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
];

/** A parameter's default, typed for its own row's `type` at the time of edit. */
function coerceDefault(
  raw: string,
  type: DashboardWidgetQueryParameterDeclaration["type"],
): DashboardWidgetQueryParameterDeclaration["default"] {
  if (raw === "") return undefined;
  if (type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (type === "boolean") return raw === "true";
  return raw;
}

function defaultInputValue(value: DashboardWidgetQueryParameterDeclaration["default"]): string {
  return value === undefined ? "" : String(value);
}

/** What stops a declared param's name being valid, or `undefined`. */
function nameProblem(name: string): string | undefined {
  if (name.trim().length === 0) return undefined;
  return reservedPrefixProblem(name);
}

/**
 * Whether every declared parameter clears the reserved-prefix contract —
 * the same `nameProblem` a row shows inline. The Save gate reuses this so
 * a `dashboard_context_`-prefixed name can't be submitted, not just flagged.
 */
export function declaredParamsAreValid(queries: DashboardWidgetQuery[]): boolean {
  return queries.every((query) =>
    (query.parameters ?? []).every((param) => nameProblem(param.name) === undefined),
  );
}

/** Builds one row's view model for the shared {@link QueryParametersPanel}. */
function rowVM({
  param,
  index,
  onChange,
  onRemove,
}: {
  param: DashboardWidgetQueryParameterDeclaration;
  index: number;
  onChange: (next: DashboardWidgetQueryParameterDeclaration) => void;
  onRemove: () => void;
}): QueryParameterRowVM {
  return {
    id: `param-${index}`,
    name: param.name,
    onNameChange: (name) => onChange({ ...param, name }),
    type: param.type,
    onTypeChange: (type) =>
      onChange({
        ...param,
        type: type as DashboardWidgetQueryParameterDeclaration["type"],
        default: undefined,
      }),
    value: defaultInputValue(param.default),
    onValueChange: (raw) => onChange({ ...param, default: coerceDefault(raw, param.type) }),
    valueKind: param.type === "boolean" ? "boolean" : "input",
    inputType: param.type === "number" ? "number" : "text",
    onRemove,
    problem: nameProblem(param.name),
  };
}

interface DashboardWidgetQueryParamsEditorProps {
  params: DashboardWidgetQueryParameterDeclaration[];
  onChange: (params: DashboardWidgetQueryParameterDeclaration[]) => void;
}

export function DashboardWidgetQueryParamsEditor({
  params,
  onChange,
}: DashboardWidgetQueryParamsEditorProps) {
  return (
    <QueryParametersPanel
      reserved={RESERVED_PARAMETERS}
      typeOptions={TYPE_OPTIONS}
      rows={params.map((param, index) =>
        rowVM({
          param,
          index,
          onChange: (next) => {
            const updated = [...params];
            updated[index] = next;
            onChange(updated);
          },
          onRemove: () => onChange(params.filter((_, i) => i !== index)),
        }),
      )}
      onAdd={() => onChange([...params, { name: "", type: "string", default: undefined }])}
    />
  );
}
