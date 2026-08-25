/**
 * The parameter overrides of a run, as one row per parameter.
 *
 * A row holds a key, a value and a lock. The lock hides the value while it is
 * typed and keeps it out of everything the suite writes down, so a credential
 * and a plain value sit in the same list. The secrets the cases declare are
 * rows of that list too: their key is fixed and their value is required.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { chakra, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Lock, LockOpen, Plus, X } from "lucide-react";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { Tooltip } from "~/components/ui/tooltip";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import { DIALOG_FIELD_STYLE } from "../shared/DialogFields";
import { FG_MUTED } from "../shared/design";
import type { ParameterRow } from "./parameter-rows";

/** What a secret with no value yet says under its row. */
const MISSING_SECRET_MESSAGE = "Type the value to start the run.";

const NAME_COLUMN_WIDTH = "150px";

export function ParameterRowsEditor({
  rows,
  onChangeRow,
  onAddRow,
  onRemoveRow,
  declaredSecrets,
  secretValues,
  onChangeSecretValue,
  disabled,
}: {
  /** The rows a person may edit: the plain values and the ad hoc secrets. */
  rows: ParameterRow[];
  onChangeRow: (index: number, patch: Partial<ParameterRow>) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  /** The secrets the cases declare, which are rows with a fixed key. */
  declaredSecrets: ScenarioParameterDefinition[];
  secretValues: Record<string, string>;
  onChangeSecretValue: (name: string, value: string) => void;
  disabled: boolean;
}) {
  return (
    <VStack align="stretch" gap={1.5} data-testid="run-dialog-parameter-rows">
      {rows.map((row, index) => (
        <EditableRow
          // The rows are addressed by position: a key is typed into the row
          // and cannot identify it while it is still being written.
          key={index}
          row={row}
          index={index}
          onChangeRow={onChangeRow}
          onRemoveRow={onRemoveRow}
          disabled={disabled}
        />
      ))}
      {declaredSecrets.map((definition) => (
        <DeclaredSecretRow
          key={definition.name}
          definition={definition}
          value={secretValues[definition.name] ?? ""}
          onChange={onChangeSecretValue}
          disabled={disabled}
        />
      ))}
      <chakra.button
        type="button"
        alignSelf="flex-start"
        display="flex"
        alignItems="center"
        gap={1}
        marginTop={0.5}
        fontSize="11.5px"
        fontWeight="medium"
        color={FG_MUTED}
        cursor="pointer"
        _hover={{ color: "fg" }}
        aria-label="Add a parameter"
        disabled={disabled}
        onClick={onAddRow}
        data-testid="run-dialog-parameter-add-row"
      >
        <Plus size={12} />
        Add parameter
      </chakra.button>
    </VStack>
  );
}

/** One row a person may rename, retype, lock and take away. */
function EditableRow({
  row,
  index,
  onChangeRow,
  onRemoveRow,
  disabled,
}: {
  row: ParameterRow;
  index: number;
  onChangeRow: (index: number, patch: Partial<ParameterRow>) => void;
  onRemoveRow: (index: number) => void;
  disabled: boolean;
}) {
  const isMissing = row.secret && row.name.trim() !== "" && row.value === "";

  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2}>
        <Input
          {...DIALOG_FIELD_STYLE}
          flex={`0 0 ${NAME_COLUMN_WIDTH}`}
          fontFamily="mono"
          fontSize="12px"
          placeholder="name"
          aria-label={`Parameter ${index + 1} name`}
          value={row.name}
          onChange={(event) => onChangeRow(index, { name: event.target.value })}
          disabled={disabled}
          data-testid={`run-dialog-parameter-name-${index}`}
        />
        <Input
          {...DIALOG_FIELD_STYLE}
          flex={1}
          minWidth={0}
          fontFamily="mono"
          fontSize="12px"
          type={row.secret ? "password" : "text"}
          autoComplete={row.secret ? "new-password" : undefined}
          placeholder="value"
          aria-label={`Parameter ${index + 1} value`}
          aria-invalid={isMissing || undefined}
          value={row.value}
          onChange={(event) =>
            onChangeRow(index, { value: event.target.value })
          }
          disabled={disabled}
          data-testid={`run-dialog-parameter-value-${index}`}
        />
        <LockToggle
          isSecret={row.secret}
          disabled={disabled}
          onToggle={() => onChangeRow(index, { secret: !row.secret })}
          label={
            row.secret
              ? `Stop hiding the value of parameter ${index + 1}`
              : `Hide the value of parameter ${index + 1}`
          }
          testId={`run-dialog-parameter-lock-${index}`}
        />
        <chakra.button
          type="button"
          display="flex"
          alignItems="center"
          color={FG_MUTED}
          cursor="pointer"
          _hover={{ color: "red.fg" }}
          title="Remove"
          aria-label={`Remove parameter ${index + 1}`}
          disabled={disabled}
          onClick={() => onRemoveRow(index)}
          data-testid={`run-dialog-parameter-remove-${index}`}
        >
          <X size={13} />
        </chakra.button>
      </HStack>
      {isMissing && <MissingValueMessage testId={`row-${index}`} />}
    </VStack>
  );
}

/** One secret the cases declare: the key is theirs, the value is this run's. */
function DeclaredSecretRow({
  definition,
  value,
  onChange,
  disabled,
}: {
  definition: ScenarioParameterDefinition;
  value: string;
  onChange: (name: string, value: string) => void;
  disabled: boolean;
}) {
  const isMissing = value === "";

  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2}>
        <HStack
          {...DIALOG_FIELD_STYLE}
          flex={`0 0 ${NAME_COLUMN_WIDTH}`}
          gap={1}
          minWidth={0}
          background="bg.muted"
        >
          <Text fontFamily="mono" fontSize="12px" truncate>
            {definition.name}
          </Text>
          {definition.description && (
            <FieldInfoTooltip
              description={definition.description}
              testId={`run-dialog-parameter-info-${definition.name}`}
            />
          )}
        </HStack>
        <Input
          {...DIALOG_FIELD_STYLE}
          flex={1}
          minWidth={0}
          fontFamily="mono"
          fontSize="12px"
          type="password"
          autoComplete="new-password"
          required
          placeholder="value"
          aria-label={definition.name}
          aria-invalid={isMissing || undefined}
          value={value}
          onChange={(event) => onChange(definition.name, event.target.value)}
          disabled={disabled}
          data-testid={`run-dialog-parameter-value-${definition.name}`}
        />
        <LockToggle
          isSecret
          disabled
          onToggle={() => undefined}
          label={`${definition.name} is declared secret by the test cases`}
          testId={`run-dialog-parameter-lock-${definition.name}`}
        />
        <chakra.span width="13px" flexShrink={0} />
      </HStack>
      {isMissing && <MissingValueMessage testId={definition.name} />}
    </VStack>
  );
}

/** The lock that says a value is a credential. */
function LockToggle({
  isSecret,
  disabled,
  onToggle,
  label,
  testId,
}: {
  isSecret: boolean;
  disabled: boolean;
  onToggle: () => void;
  label: string;
  testId: string;
}) {
  const Icon = isSecret ? Lock : LockOpen;

  return (
    <Tooltip content={label} positioning={{ placement: "top" }}>
      <chakra.button
        type="button"
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
        width="22px"
        height="22px"
        borderRadius="md"
        // A closed lock reads at a glance; an open one stays out of the way.
        color={isSecret ? "fg" : FG_MUTED}
        opacity={isSecret ? 1 : 0.5}
        background={isSecret ? "bg.muted" : "transparent"}
        cursor={disabled ? "default" : "pointer"}
        _hover={disabled ? undefined : { color: "fg", opacity: 1 }}
        aria-label={label}
        aria-pressed={isSecret}
        disabled={disabled}
        onClick={onToggle}
        data-testid={testId}
      >
        <Icon size={13} />
      </chakra.button>
    </Tooltip>
  );
}

function MissingValueMessage({ testId }: { testId: string }) {
  return (
    <Text
      fontSize="11px"
      color="red.fg"
      paddingLeft={`calc(${NAME_COLUMN_WIDTH} + var(--chakra-spacing-2))`}
      data-testid={`run-dialog-parameter-error-${testId}`}
    >
      {MISSING_SECRET_MESSAGE}
    </Text>
  );
}
