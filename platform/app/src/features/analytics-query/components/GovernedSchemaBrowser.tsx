/**
 * The governed schema, browsable.
 *
 * Everything on screen came back from the schema endpoint for this member. A
 * column the response marks unavailable stays listed — that is how the member
 * learns which permission would unlock it — but it is visibly disabled and
 * carries no affordance that would put its name in the editor, because the
 * validator would refuse it.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import {
  Badge,
  Box,
  Button,
  Code,
  HStack,
  Spinner,
  Stack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { CopyButton } from "~/components/CopyButton";
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
    <Box
      paddingY={1}
      aria-disabled={disabled || undefined}
      opacity={disabled ? 0.55 : 1}
      data-testid={`governed-schema-column-${column.name}`}
    >
      <HStack gap={2} align="baseline">
        <Text fontFamily="mono" fontSize="13px">
          {column.name}
        </Text>
        <Badge size="sm" variant="subtle">
          {column.type}
        </Badge>
        {column.unit && (
          <Text fontSize="12px" color="fg.muted">
            {column.unit}
          </Text>
        )}
        {!disabled && (
          <Button
            size="xs"
            variant="ghost"
            aria-label={`Insert column ${column.name}`}
            onClick={() => onInsert(column.qualifiedName)}
          >
            Insert
          </Button>
        )}
      </HStack>
      {column.description && (
        <Text fontSize="12px" color="fg.muted">
          {column.description}
        </Text>
      )}
      {disabled && (
        <Text fontSize="12px" color="fg.muted">
          {gateSentence(column.gates)}
        </Text>
      )}
    </Box>
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
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="8px"
      padding={2}
      width="full"
    >
      <HStack gap={1} width="full">
        <Button
          variant="ghost"
          size="sm"
          flex="1"
          justifyContent="flex-start"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <Box aria-hidden="true" display="flex">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </Box>
          <Text fontFamily="mono" fontSize="13px">
            {dataset.name}
          </Text>
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Insert dataset ${dataset.name}`}
          onClick={() => onInsert(dataset.name)}
        >
          Insert
        </Button>
        <CopyButton
          value={dataset.name}
          label="Dataset name"
          aria-label={`Copy dataset ${dataset.name}`}
        />
      </HStack>

      {expanded && (
        <Stack gap={2} paddingX={2} paddingTop={2}>
          <Text fontSize="13px" color="fg.muted">
            {dataset.description}
          </Text>
          <Stack gap={0.5} fontSize="12px" color="fg.muted">
            <Text>Grain: {dataset.grain}</Text>
            <Text>Freshness: {dataset.freshness}</Text>
            <Text>Time column: {dataset.timeColumn}</Text>
            <Text>
              Join keys:{" "}
              {dataset.joinKeys.length > 0
                ? dataset.joinKeys.join(", ")
                : "none"}
            </Text>
          </Stack>

          <Box>
            <HStack gap={1} justifyContent="space-between">
              <Text fontSize="12px" fontWeight="600">
                Example query
              </Text>
              <HStack gap={0}>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Insert example query for ${dataset.name}`}
                  onClick={() => onInsert(dataset.exampleSql)}
                >
                  Insert
                </Button>
                <CopyButton
                  value={dataset.exampleSql}
                  label="Example query"
                  aria-label={`Copy example query for ${dataset.name}`}
                />
              </HStack>
            </HStack>
            <Code
              display="block"
              whiteSpace="pre-wrap"
              fontSize="11.5px"
              padding={2}
              borderRadius="6px"
            >
              {dataset.exampleSql}
            </Code>
          </Box>

          <Box>
            <Text fontSize="12px" fontWeight="600">
              Columns
            </Text>
            {dataset.columns.map((column) => (
              <ColumnRow
                key={column.name}
                column={column}
                onInsert={onInsert}
              />
            ))}
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
      data-testid="governed-schema-browser"
    >
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
        <Text fontSize="13px" color="fg.muted" padding={2}>
          {model.datasets.length === 0
            ? "No datasets are available to you yet."
            : "Nothing matches that search."}
        </Text>
      ) : (
        visible.datasets.map((dataset) => (
          <DatasetEntry
            key={dataset.name}
            dataset={dataset}
            expanded={expanded.has(dataset.name)}
            onToggle={() => toggle(dataset.name)}
            onInsert={onInsert}
          />
        ))
      )}
    </VStack>
  );
}
