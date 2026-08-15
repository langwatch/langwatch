import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import {
  displayOptionalValue,
  serializeOptionalScalarValue,
} from "~/utils/jsonValueText";

type ParameterDefinitionsInputProps = {
  value: ScenarioParameterDefinition[];
  onChange: (value: ScenarioParameterDefinition[]) => void;
  /** Validation message for the row at the same index. */
  rowErrors?: (string | undefined)[];
  disabled?: boolean;
};

/**
 * Editor for the parameters a scenario declares: a name, an optional
 * description, and an optional default value per row.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */
export function ParameterDefinitionsInput({
  value,
  onChange,
  rowErrors,
  disabled = false,
}: ParameterDefinitionsInputProps) {
  const handleAdd = () => {
    onChange([...value, { name: "" }]);
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleUpdate = (
    index: number,
    patch: Partial<ScenarioParameterDefinition>,
  ) => {
    const definition = value[index];
    if (!definition) return;
    const updated = [...value];
    updated[index] = { ...definition, ...patch };
    onChange(updated);
  };

  return (
    <VStack align="stretch" gap={2} data-testid="scenario-parameters-list">
      {value.length > 0 && (
        <HStack gap={2} paddingRight={8}>
          <ColumnLabel flex={1}>Name</ColumnLabel>
          <ColumnLabel flex={2}>Description</ColumnLabel>
          <ColumnLabel flex={1}>Default value</ColumnLabel>
        </HStack>
      )}

      {value.map((definition, index) => (
        <ParameterRow
          // Rows are addressed by position: a name is empty while it is being
          // typed, so it cannot key the row.
          key={index}
          index={index}
          definition={definition}
          error={rowErrors?.[index]}
          disabled={disabled}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
        />
      ))}

      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          alignSelf="start"
          data-testid="add-scenario-parameter-button"
        >
          <Plus size={14} />
          {value.length === 0 ? "Add the first parameter" : "Add parameter"}
        </Button>
      )}
    </VStack>
  );
}

function ParameterRow({
  index,
  definition,
  error,
  disabled,
  onUpdate,
  onRemove,
}: {
  index: number;
  definition: ScenarioParameterDefinition;
  error?: string;
  disabled: boolean;
  onUpdate: (
    index: number,
    patch: Partial<ScenarioParameterDefinition>,
  ) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2}>
        <Input
          value={definition.name}
          onChange={(e) => onUpdate(index, { name: e.target.value })}
          placeholder="account_tier"
          size="sm"
          flex={1}
          fontFamily="mono"
          fontSize="13px"
          disabled={disabled}
          aria-label={`Parameter ${index + 1} name`}
          data-testid={`scenario-parameter-name-${index}`}
        />
        <Input
          value={definition.description ?? ""}
          onChange={(e) =>
            onUpdate(index, {
              description: e.target.value === "" ? undefined : e.target.value,
            })
          }
          placeholder="Which plan the customer is on"
          size="sm"
          flex={2}
          disabled={disabled}
          aria-label={`Parameter ${index + 1} description`}
          data-testid={`scenario-parameter-description-${index}`}
        />
        <Input
          value={displayOptionalValue(definition.defaultValue)}
          onChange={(e) =>
            onUpdate(index, {
              defaultValue: serializeOptionalScalarValue(e.target.value),
            })
          }
          placeholder="gold"
          size="sm"
          flex={1}
          fontFamily="mono"
          fontSize="13px"
          disabled={disabled}
          aria-label={`Parameter ${index + 1} default value`}
          data-testid={`scenario-parameter-default-${index}`}
        />
        {!disabled && (
          <Tooltip
            content="Remove parameter"
            positioning={{ placement: "top" }}
          >
            <Button
              type="button"
              size="xs"
              variant="ghost"
              colorPalette="gray"
              onClick={() => onRemove(index)}
              color="fg.subtle"
              aria-label={`Remove parameter ${index + 1}`}
              data-testid={`remove-scenario-parameter-${index}`}
            >
              <X size={14} />
            </Button>
          </Tooltip>
        )}
      </HStack>
      {error && (
        <Text
          fontSize="xs"
          color="fg.error"
          data-testid={`scenario-parameter-error-${index}`}
        >
          {error}
        </Text>
      )}
    </VStack>
  );
}

function ColumnLabel({
  children,
  flex,
}: {
  children: React.ReactNode;
  flex: number;
}) {
  return (
    <Text fontSize="11px" color="fg.subtle" flex={flex}>
      {children}
    </Text>
  );
}
