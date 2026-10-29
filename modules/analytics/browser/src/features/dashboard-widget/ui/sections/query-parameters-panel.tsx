/**
 * Shared LangWatchQL parameters panel: a locked "Dashboard context" group (the
 * `RESERVED_PARAMETERS` the executor binds) above an editable "Parameters" group led by a
 * dashboard query's built-in `sources` row (AC200), styled like VariablesSection.
 */

/**
 * Both the LWQL workbench (`LangWatchQLParametersEditor`) and the dashboard-widget query editor
 * (`DashboardWidgetQueryParamsEditor`) drive this panel through the `QueryParameterRowVM`
 * adapter shape, rather than hand-duplicating the row markup.
 */

import type { TraceSource } from "@langwatch/analytics-contract";
import {
  DASHBOARD_CONTEXT_PARAMETER_PREFIX,
  type RESERVED_PARAMETERS,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Badge,
  Box,
  Button,
  chakra,
  HStack,
  Input,
  Stack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Plus, Trash2, X } from "lucide-react";

import { FieldTypeSelect } from "../../../../ui/sections/prompt/variables/variable-type/field-type-select.tsx";
import { VariableTypeIcon } from "../../../../ui/sections/prompt/variables/variable-type/variable-type-icon.tsx";

/** Structurally identical to prompt-web's own (unexported) `FieldTypeOption`. */
type FieldTypeOption = { value: string; label: string };

/** A declared parameter's name colliding with the dashboard-context prefix. */
export function reservedPrefixProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.startsWith(DASHBOARD_CONTEXT_PARAMETER_PREFIX)
    ? `Names starting with "${DASHBOARD_CONTEXT_PARAMETER_PREFIX}" are set by the dashboard.`
    : undefined;
}

const SELECT_STYLE = {
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "6px",
  textStyle: "bodySm",
  paddingX: 2,
  height: "32px",
} as const;

/** One editable row's view model — the adapter each call site builds. */
export interface QueryParameterRowVM {
  readonly id: string;
  readonly name: string;
  readonly onNameChange: (name: string) => void;
  /** A `typeOptions` value — what the type picker shows and offers. */
  readonly type: string;
  readonly onTypeChange: (type: string) => void;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** "boolean" renders a true/false select; "disabled" a blanked, inert input. */
  readonly valueKind: "input" | "boolean" | "disabled";
  readonly inputType?: "text" | "number";
  readonly onRemove: () => void;
  /** Inline error text, shown under the row (e.g. a name collision). */
  readonly problem?: string;
}

/** A query's built-in `sources` row: the origins it counts, as removable pills. */
export interface QuerySourcesVM {
  /** What the query runs with: its list, or the default when unset. */
  readonly picked: readonly TraceSource[];
  /** Every source, in the order the menu offers the ones not picked. */
  readonly all: readonly TraceSource[];
  readonly onChange: (next: TraceSource[]) => void;
}

export interface QueryParametersPanelProps {
  reserved: readonly (typeof RESERVED_PARAMETERS)[number][];
  /**
   * Live values for the reserved rows, keyed by name. Absent when unknown —
   * the row falls back to showing its description instead.
   */
  dashboardContextValues?: Readonly<Record<string, string>>;
  rows: readonly QueryParameterRowVM[];
  typeOptions: readonly FieldTypeOption[];
  onAdd: () => void;
  /** A dashboard query's `sources` row; absent where a query counts every origin. */
  sources?: QuerySourcesVM;
}

function DashboardContextRow({
  reserved,
  value,
}: {
  reserved: (typeof RESERVED_PARAMETERS)[number];
  value?: string;
}) {
  return (
    <HStack gap={2} title={reserved.description}>
      <Box flexShrink={0}>
        <VariableTypeIcon type={reserved.type} size={14} />
      </Box>
      <Text textStyle="monoSm" flex={1} minWidth={0} truncate color="fg.muted">
        {reserved.name}
      </Text>
      <Text color="fg.subtle" fontSize="sm" flexShrink={0}>
        =
      </Text>
      <Text
        textStyle="caption"
        fontFamily="mono"
        color="fg.muted"
        flexShrink={0}
        truncate
        maxWidth="220px"
      >
        {value ?? reserved.description}
      </Text>
      <BuiltInBadge />
      {/* Spacer matching the remove button's width so name/type columns line
          up with the editable rows below. */}
      <Box width="26px" flexShrink={0} />
    </HStack>
  );
}

function BuiltInBadge() {
  return (
    <Badge size="sm" colorPalette="gray" flexShrink={0}>
      built-in
    </Badge>
  );
}

function SourcePill({ source, onRemove }: { source: TraceSource; onRemove: () => void }) {
  return (
    <HStack
      as="span"
      gap={1}
      paddingLeft={2.5}
      paddingRight={1}
      borderRadius="full"
      borderWidth="1px"
      borderColor="colorPalette.emphasized"
      background="colorPalette.subtle"
      colorPalette="orange"
      textStyle="monoSm"
    >
      {source}
      <Button
        size="2xs"
        variant="ghost"
        minWidth={0}
        height="auto"
        padding={0.5}
        borderRadius="full"
        color="fg.subtle"
        aria-label={`Remove ${source}`}
        onClick={onRemove}
      >
        <X size={11} />
      </Button>
    </HStack>
  );
}

function AddSourceMenu({
  missing,
  onAdd,
}: {
  missing: readonly TraceSource[];
  onAdd: (source: TraceSource) => void;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger asChild>
        <Button
          size="2xs"
          variant="ghost"
          borderRadius="full"
          borderWidth="1px"
          borderStyle="dashed"
          borderColor="border"
          color="fg.muted"
          paddingX={2.5}
        >
          <Plus size={11} /> Add source
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="176px">
        {missing.map((source) => (
          <Menu.Item key={source} value={source} textStyle="monoSm" onClick={() => onAdd(source)}>
            {source}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

/** `sources = [pills] + Add source`, styled as a dashboard-context row (dashboards-v2 AC200). */
function SourcesRow({ sources }: { sources: QuerySourcesVM }) {
  const { picked, all, onChange } = sources;
  const missing = all.filter((source) => !picked.includes(source));
  return (
    <HStack gap={2} align="start" data-testid="query-sources">
      <Box flexShrink={0} paddingTop={1}>
        <VariableTypeIcon type="list[str]" size={14} />
      </Box>
      <Text textStyle="monoSm" color="fg.muted" flexShrink={0} paddingTop={0.5}>
        sources
      </Text>
      <Text color="fg.subtle" fontSize="sm" flexShrink={0}>
        =
      </Text>
      <HStack flex={1} minWidth={0} gap={1.5} wrap="wrap">
        {picked.map((source) => (
          <SourcePill
            key={source}
            source={source}
            onRemove={() => onChange(picked.filter((other) => other !== source))}
          />
        ))}
        {missing.length > 0 && (
          <AddSourceMenu missing={missing} onAdd={(source) => onChange([...picked, source])} />
        )}
      </HStack>
      <BuiltInBadge />
      <Box width="26px" flexShrink={0} />
    </HStack>
  );
}

function ParameterValueField({ row }: { row: QueryParameterRowVM }) {
  if (row.valueKind === "boolean") {
    return (
      <chakra.select
        aria-label="Parameter value"
        value={row.value === "true" ? "true" : "false"}
        {...SELECT_STYLE}
        onChange={(event) => row.onValueChange(event.target.value)}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </chakra.select>
    );
  }

  return (
    <Input
      size="sm"
      aria-label="Parameter value"
      placeholder="Value"
      type={row.inputType === "number" ? "number" : "text"}
      disabled={row.valueKind === "disabled"}
      value={row.valueKind === "disabled" ? "" : row.value}
      onChange={(event) => row.onValueChange(event.target.value)}
      flex={1}
      minWidth={0}
      fontFamily="mono"
      textStyle="bodySm"
    />
  );
}

function ParameterRow({
  row,
  typeOptions,
}: {
  row: QueryParameterRowVM;
  typeOptions: readonly FieldTypeOption[];
}) {
  return (
    <Stack gap={1}>
      <HStack gap={2}>
        <FieldTypeSelect
          value={row.type}
          options={[...typeOptions]}
          onChange={row.onTypeChange}
          testId={`param-type-select-${row.id}`}
        />
        <Input
          size="sm"
          aria-label="Parameter name"
          placeholder="Name"
          fontFamily="mono"
          textStyle="bodySm"
          value={row.name}
          onChange={(event) => row.onNameChange(event.target.value)}
          flex={1}
          minWidth={0}
        />
        <Text color="fg.subtle" fontSize="sm" flexShrink={0}>
          =
        </Text>
        <ParameterValueField row={row} />
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Remove parameter ${row.name || row.id}`}
          onClick={row.onRemove}
          flexShrink={0}
        >
          <Trash2 size={14} />
        </Button>
      </HStack>
      {row.problem && (
        <Text textStyle="caption" color="red.fg">
          {row.problem}
        </Text>
      )}
    </Stack>
  );
}

export function QueryParametersPanel({
  reserved,
  dashboardContextValues = {},
  rows,
  typeOptions,
  onAdd,
  sources,
}: QueryParametersPanelProps) {
  return (
    <VStack align="stretch" gap={3} width="full">
      <Box>
        <Text textStyle="micro" fontWeight="600" color="fg.muted" marginBottom={1}>
          Dashboard context · provided by the dashboard · read-only
        </Text>
        <Stack gap={1}>
          {reserved.map((r) => (
            <DashboardContextRow
              key={r.name}
              reserved={r}
              {...(dashboardContextValues[r.name] !== undefined
                ? { value: dashboardContextValues[r.name] }
                : {})}
            />
          ))}
        </Stack>
      </Box>

      <Box>
        <Text textStyle="micro" fontWeight="600" color="fg.muted" marginBottom={1}>
          Parameters
        </Text>
        <Stack gap={2}>
          {sources && <SourcesRow sources={sources} />}
          {rows.length === 0 && !sources && (
            <NoDataInfoBlock
              size="line"
              title="No parameters declared yet."
              action={{ label: "Add parameter", onClick: onAdd }}
            />
          )}
          {rows.map((row) => (
            <ParameterRow key={row.id} row={row} typeOptions={typeOptions} />
          ))}
          {(rows.length > 0 || sources) && (
            <Box>
              <Button size="xs" variant="outline" onClick={onAdd}>
                <Plus size={14} /> Add parameter
              </Button>
            </Box>
          )}
        </Stack>
      </Box>
    </VStack>
  );
}
