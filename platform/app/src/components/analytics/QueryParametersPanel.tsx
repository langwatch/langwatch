/**
 * Shared parameters panel for LangWatchQL: a locked "Dashboard context" group
 * (the `RESERVED_PARAMETERS` the executor binds automatically) above an
 * editable "Parameters" group (what the member declares), in the same
 * "variables" visual language as the prompt playground's
 * {@link ~/components/variables/VariablesSection}.
 *
 * Both the LWQL workbench (`LangWatchQLParametersEditor`, free-text rows keyed
 * by name) and the dashboard-widget query editor
 * (`DashboardWidgetQueryParamsEditor`, typed declarations) drive this same
 * panel through the `QueryParameterRowVM` adapter shape rather than
 * hand-duplicating the row markup.
 */

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
} from "@chakra-ui/react";
import { Plus, Trash2 } from "lucide-react";

import {
  FieldTypeSelect,
  type FieldTypeOption,
} from "~/prompts/components/ui/FieldTypeSelect";
import { VariableTypeIcon } from "~/prompts/components/ui/VariableTypeIcon";
import {
  DASHBOARD_CONTEXT_PARAMETER_PREFIX,
  type RESERVED_PARAMETERS,
} from "~/server/analytics/dashboardWidgetDefinition";

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
  fontSize: "13px",
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
      <Text
        fontSize="12px"
        fontFamily="mono"
        flex={1}
        minWidth={0}
        truncate
        color="fg.muted"
      >
        {reserved.name}
      </Text>
      <Text color="fg.subtle" fontSize="sm" flexShrink={0}>
        =
      </Text>
      <Text
        fontSize="12px"
        fontFamily="mono"
        color="fg.muted"
        flexShrink={0}
        truncate
        maxWidth="220px"
      >
        {value ?? reserved.description}
      </Text>
      <Badge size="sm" colorPalette="gray" flexShrink={0}>
        built-in
      </Badge>
      {/* Spacer matching the remove button's width so name/type columns line
          up with the editable rows below. */}
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
      fontSize="13px"
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
          fontSize="13px"
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
        <Text fontSize="12px" color="red.fg">
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
}: QueryParametersPanelProps) {
  return (
    <VStack align="stretch" gap={3} width="full">
      <Box>
        <Text fontSize="11px" fontWeight="600" color="fg.muted" marginBottom={1}>
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
        <Text fontSize="11px" fontWeight="600" color="fg.muted" marginBottom={1}>
          Parameters · declared by you
        </Text>
        <Stack gap={2}>
          {rows.length === 0 && (
            <Text fontSize="12px" color="fg.muted">
              No parameters declared yet.
            </Text>
          )}
          {rows.map((row) => (
            <ParameterRow key={row.id} row={row} typeOptions={typeOptions} />
          ))}
          <Box>
            <Button size="xs" variant="outline" onClick={onAdd}>
              <Plus size={14} /> Add parameter
            </Button>
          </Box>
        </Stack>
      </Box>
    </VStack>
  );
}
