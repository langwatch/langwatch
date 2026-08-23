import { Box, Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { Switch } from "~/components/ui/switch";
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
 * description, an optional default value, and whether the value is secret.
 *
 * The editor always shows a row to type in, so an empty list renders one blank
 * row. That row becomes a declaration on the first keystroke, which keeps a
 * scenario that declares nothing free of an empty declaration it would have to
 * name before it could save.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */
export function ParameterDefinitionsInput({
  value,
  onChange,
  rowErrors,
  disabled = false,
}: ParameterDefinitionsInputProps) {
  const rows = value.length > 0 ? value : [BLANK_DEFINITION];

  const handleAdd = () => {
    onChange([...rows, { name: "" }]);
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleUpdate: UpdateRow = ({ index, patch }) => {
    const definition = rows[index];
    if (!definition) return;
    const updated = [...rows];
    updated[index] = withoutEmptyFields({ ...definition, ...patch });
    onChange(updated);
  };

  return (
    <VStack align="stretch" gap={2} data-testid="scenario-parameters-list">
      <HStack gap={2} paddingRight={8}>
        <ColumnLabel flex={NAME_FLEX}>Name</ColumnLabel>
        <ColumnLabel flex={DESCRIPTION_FLEX}>Description</ColumnLabel>
        <ColumnLabel flex={DEFAULT_VALUE_FLEX}>Default value</ColumnLabel>
        <ColumnLabel width={SECRET_WIDTH}>Secret</ColumnLabel>
      </HStack>

      {rows.map((definition, index) => (
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
          Add parameter
        </Button>
      )}
    </VStack>
  );
}

/** The row the editor shows when a scenario declares nothing yet. */
const BLANK_DEFINITION: ScenarioParameterDefinition = { name: "" };

/**
 * How the fields share the row.
 *
 * The name column carries a monospace example placeholder, so it needs more
 * room than the quarter of the row an even split with the description would
 * leave it. The secret switch takes a fixed width instead of a share, because
 * it holds one control of a known size.
 */
const NAME_FLEX = 1.35;
const DESCRIPTION_FLEX = 1.65;
const DEFAULT_VALUE_FLEX = 1;
const SECRET_WIDTH = "52px";

/** Why a secret parameter's default value input is not writable. */
const SECRET_DEFAULT_TOOLTIP =
  "A secret parameter has no default value. Supply the value when the run starts.";

/** What the secret switch does, on the switch itself. */
const SECRET_SWITCH_TOOLTIP =
  "The value is a credential. The run delivers it to the target as secrets.NAME, and records the name without the value.";

/**
 * The declaration with every field the row left empty taken out of it.
 *
 * A key holding undefined survives as an own key, so a default value cleared
 * by the secret switch would still be read as a declared field by anything
 * that counts keys rather than values.
 */
function withoutEmptyFields(
  definition: ScenarioParameterDefinition,
): ScenarioParameterDefinition {
  return Object.fromEntries(
    Object.entries(definition).filter(([, value]) => value !== undefined),
  ) as ScenarioParameterDefinition;
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
  onUpdate: UpdateRow;
  onRemove: (index: number) => void;
}) {
  const isSecret = definition.secret === true;

  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={2}>
        <Input
          value={definition.name}
          onChange={(e) => onUpdate({ index, patch: { name: e.target.value } })}
          placeholder="e.g. account_tier"
          size="sm"
          flex={NAME_FLEX}
          fontFamily="mono"
          fontSize="13px"
          disabled={disabled}
          aria-label={`Parameter ${index + 1} name`}
          data-testid={`scenario-parameter-name-${index}`}
        />
        <Input
          value={definition.description ?? ""}
          onChange={(e) =>
            onUpdate({
              index,
              patch: {
                description: e.target.value === "" ? undefined : e.target.value,
              },
            })
          }
          placeholder="Which plan the customer is on"
          size="sm"
          flex={DESCRIPTION_FLEX}
          disabled={disabled}
          aria-label={`Parameter ${index + 1} description`}
          data-testid={`scenario-parameter-description-${index}`}
        />
        <DefaultValueCell
          index={index}
          definition={definition}
          disabled={disabled}
          isSecret={isSecret}
          onUpdate={onUpdate}
        />
        <SecretSwitchCell
          index={index}
          disabled={disabled}
          isSecret={isSecret}
          onUpdate={onUpdate}
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

type UpdateRow = (update: {
  index: number;
  patch: Partial<ScenarioParameterDefinition>;
}) => void;

function DefaultValueCell({
  index,
  definition,
  disabled,
  isSecret,
  onUpdate,
}: {
  index: number;
  definition: ScenarioParameterDefinition;
  disabled: boolean;
  isSecret: boolean;
  onUpdate: UpdateRow;
}) {
  return (
    <Tooltip
      content={SECRET_DEFAULT_TOOLTIP}
      disabled={!isSecret}
      positioning={{ placement: "top" }}
    >
      <Box flex={DEFAULT_VALUE_FLEX} minWidth={0}>
        <Input
          value={displayOptionalValue(definition.defaultValue)}
          onChange={(e) =>
            onUpdate({
              index,
              patch: {
                defaultValue: serializeOptionalScalarValue(e.target.value),
              },
            })
          }
          placeholder={isSecret ? "" : "gold"}
          size="sm"
          width="full"
          fontFamily="mono"
          fontSize="13px"
          disabled={disabled || isSecret}
          aria-label={`Parameter ${index + 1} default value`}
          data-testid={`scenario-parameter-default-${index}`}
        />
      </Box>
    </Tooltip>
  );
}

function SecretSwitchCell({
  index,
  disabled,
  isSecret,
  onUpdate,
}: {
  index: number;
  disabled: boolean;
  isSecret: boolean;
  onUpdate: UpdateRow;
}) {
  return (
    <Tooltip content={SECRET_SWITCH_TOOLTIP} positioning={{ placement: "top" }}>
      <Box width={SECRET_WIDTH} flexShrink={0}>
        <Switch
          size="sm"
          checked={isSecret}
          disabled={disabled}
          onCheckedChange={({ checked }) =>
            onUpdate({
              index,
              // A secret carries no default: the value is supplied when the
              // run starts, so whatever was typed is dropped here rather than
              // kept out of sight until the save is refused.
              patch: checked
                ? { secret: true, defaultValue: undefined }
                : { secret: undefined },
            })
          }
          inputProps={{
            "aria-label": `Parameter ${index + 1} secret`,
            "data-testid": `scenario-parameter-secret-${index}`,
          }}
        />
      </Box>
    </Tooltip>
  );
}

function ColumnLabel({
  children,
  flex,
  width,
}: {
  children: React.ReactNode;
  flex?: number;
  width?: string;
}) {
  return (
    <Text
      fontSize="11px"
      color="fg.subtle"
      flex={flex}
      width={width}
      flexShrink={width ? 0 : undefined}
    >
      {children}
    </Text>
  );
}
