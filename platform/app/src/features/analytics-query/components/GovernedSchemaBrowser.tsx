/**
 * The governed schema, browsable.
 *
 * Everything on screen came back from the schema endpoint for this member. A
 * column the response marks unavailable stays listed — that is how the member
 * learns which permission would unlock it — but it is visibly disabled and
 * carries no affordance that would put its name in the editor, because the
 * validator would refuse it.
 *
 * Presented as a flat panel: dataset rows that expand in place, columns as
 * click-to-insert rows, and the dataset's example statement one button away.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import {
  Badge,
  Box,
  Button,
  chakra,
  HStack,
  Spinner,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { SearchInput } from "~/components/ui/SearchInput";
import { HandledErrorAlert } from "~/features/errors";

import {
  filterGovernedSchemaModel,
  type GovernedSchemaColumnModel,
  type GovernedSchemaDatasetModel,
  type GovernedSchemaModel,
} from "../logic/governedSchemaModel";

export interface GovernedSchemaBrowserProps {
  model: GovernedSchemaModel;
  isLoading: boolean;
  /** The schema request's failure, if it had one. */
  error: unknown;
  /** Writes the given text into the editor. */
  onInsert: (text: string) => void;
}

/** Human wording for the permission a gated column waits on. */
const GATE_LABELS: Record<string, string> = {
  input: "captured input",
  output: "captured output",
  costs: "costs",
};

function gateSentence(gates: readonly string[]): string {
  const named = gates.map((gate) => GATE_LABELS[gate] ?? gate);
  if (named.length === 0) return "";
  return `Needs permission to see ${named.join(" and ")}.`;
}

function ColumnRow({
  column,
  onInsert,
}: {
  column: GovernedSchemaColumnModel;
  onInsert: (text: string) => void;
}) {
  // A withheld column is shown, never its values and never a way to name it in
  // a query. `aria-disabled` rather than removal: the point of listing it is
  // that the member can see the permission that would unlock it.
  const disabled = !column.available;

  return (
    <chakra.button
      type="button"
      display="flex"
      alignItems="center"
      gap={1.5}
      width="full"
      paddingX={1.5}
      paddingY={0.5}
      borderRadius="5px"
      textAlign="left"
      cursor={disabled ? "not-allowed" : "pointer"}
      opacity={disabled ? 0.5 : 1}
      _hover={disabled ? {} : { background: "bg.muted" }}
      aria-disabled={disabled || undefined}
      aria-label={
        disabled
          ? `Column ${column.name}, not available to your role`
          : `Insert column ${column.name}`
      }
      title={
        disabled
          ? gateSentence(column.gates)
          : (column.description ?? `Insert ${column.name} at the cursor`)
      }
      onClick={() => {
        if (!disabled) onInsert(column.qualifiedName);
      }}
      data-testid={`governed-schema-column-${column.name}`}
    >
      <Text fontFamily="mono" fontSize="11.5px">
        {column.name}
      </Text>
      {column.unit && (
        <Badge
          size="xs"
          variant="subtle"
          colorPalette="orange"
          fontSize="9.5px"
        >
          {column.unit}
        </Badge>
      )}
      <Box flex="1" />
      {disabled && (
        <Badge size="xs" variant="outline" fontSize="9.5px" color="fg.muted">
          no access
        </Badge>
      )}
      <Text fontFamily="mono" fontSize="10px" color="fg.subtle">
        {column.type}
      </Text>
    </chakra.button>
  );
}

function DatasetEntry({
  dataset,
  expanded,
  onToggle,
  onInsert,
}: {
  dataset: GovernedSchemaDatasetModel;
  expanded: boolean;
  onToggle: () => void;
  onInsert: (text: string) => void;
}) {
  return (
    <Box width="full">
      <chakra.button
        type="button"
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        paddingX={2}
        paddingY={1.5}
        borderRadius="6px"
        textAlign="left"
        cursor="pointer"
        _hover={{ background: "bg.muted" }}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <Box aria-hidden="true" display="flex" color="fg.subtle">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </Box>
        <Text fontFamily="mono" fontSize="12px" fontWeight="600" minWidth={0}>
          {dataset.name}
        </Text>
        <Box flex="1" />
        <Text fontSize="10.5px" color="fg.subtle" whiteSpace="nowrap">
          {dataset.columns.length} columns
        </Text>
      </chakra.button>

      {expanded && (
        <Stack gap={2} paddingLeft={6} paddingRight={2} paddingBottom={3}>
          <Text fontSize="11.5px" lineHeight="1.5" color="fg.muted">
            {dataset.description}
          </Text>
          <HStack gap={1} wrap="wrap">
            <Badge size="xs" variant="surface" fontSize="10px">
              {dataset.grain}
            </Badge>
            <Badge size="xs" variant="surface" fontSize="10px">
              {dataset.freshness}
            </Badge>
            <Badge
              size="xs"
              variant="surface"
              fontSize="10px"
              title="Bound this column with a range to keep the scan narrow"
            >
              time: {dataset.timeColumn}
            </Badge>
          </HStack>
          {dataset.joinKeys.length > 0 && (
            <Text fontSize="10.5px" color="fg.subtle">
              Joins on {dataset.joinKeys.join(", ")}
            </Text>
          )}

          <Stack gap={0}>
            {dataset.columns.map((column) => (
              <ColumnRow
                key={column.name}
                column={column}
                onInsert={onInsert}
              />
            ))}
          </Stack>

          <Box>
            <Button
              size="xs"
              variant="outline"
              color="orange.fg"
              aria-label={`Insert example query for ${dataset.name}`}
              onClick={() => onInsert(dataset.exampleSql)}
            >
              Insert example query
            </Button>
          </Box>
        </Stack>
      )}
    </Box>
  );
}

export function GovernedSchemaBrowser({
  model,
  isLoading,
  error,
  onInsert,
}: GovernedSchemaBrowserProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const visible = useMemo(
    () => filterGovernedSchemaModel({ model, search }),
    [model, search],
  );

  const toggle = (name: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <VStack
      align="stretch"
      gap={2}
      width="full"
      padding={3}
      data-testid="governed-schema-browser"
    >
      <HStack justify="space-between" align="baseline">
        <Text
          fontSize="11px"
          fontWeight="600"
          letterSpacing="0.06em"
          textTransform="uppercase"
          color="fg.subtle"
        >
          Datasets
        </Text>
        <Text fontSize="10.5px" color="fg.subtle">
          filtered to your role
        </Text>
      </HStack>

      <SearchInput
        aria-label="Search the schema"
        placeholder="Search datasets and columns"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {error ? (
        <HandledErrorAlert
          error={error}
          fallbackTitle="Couldn't load the schema"
        />
      ) : isLoading ? (
        <HStack gap={2} padding={2} color="fg.muted">
          <Spinner size="sm" />
          <Text fontSize="13px">Loading the schema</Text>
        </HStack>
      ) : visible.datasets.length === 0 ? (
        <Text fontSize="12px" color="fg.muted" padding={2}>
          {model.datasets.length === 0
            ? "No datasets are available to you yet."
            : `Nothing matches "${search}".`}
        </Text>
      ) : (
        <Stack gap={0.5}>
          {visible.datasets.map((dataset) => (
            <DatasetEntry
              key={dataset.name}
              dataset={dataset}
              expanded={expanded.has(dataset.name) || search.trim().length > 0}
              onToggle={() => toggle(dataset.name)}
              onInsert={onInsert}
            />
          ))}
        </Stack>
      )}
    </VStack>
  );
}
