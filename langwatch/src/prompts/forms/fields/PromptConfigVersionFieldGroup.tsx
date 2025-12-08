import {
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { Trash2 } from "lucide-react";
import { useFieldArray, useFormContext } from "react-hook-form";
import { Tooltip } from "~/components/ui/tooltip";
import { PropertySectionTitle } from "~/optimization_studio/components/properties/BasePropertiesPanel";
import type { PromptConfigFormValues } from "~/prompts";
import { TypeSelector } from "~/prompts/components/ui/TypeSelector";
import { generateUniqueIdentifier } from "~/prompts/utils/identifierUtils";

/**
 * ConfigFieldGroup
 * Single Responsibility: Manages a dynamic list of input or output field configurations.
 *
 * Handles adding, removing, and validating field identifiers for prompt configuration.
 * Generates unique default identifiers to prevent schema validation errors.
 *
 * @param title - Display title for the field group (e.g., "Inputs", "Outputs")
 * @param name - Field type: "inputs" or "outputs"
 * @param readOnly - If true, prevents editing/adding/removing fields
 */
function ConfigFieldGroup({
  title,
  name,
  readOnly,
}: {
  title: string;
  name: "inputs" | "outputs";
  readOnly?: boolean;
}) {
  const { control, setValue, getValues } =
    useFormContext<PromptConfigFormValues>();

  const fieldArrayName = `version.configData.${name}` as const;

  const { fields, append, remove } = useFieldArray({
    control,
    name: fieldArrayName,
  });

  /**
   * Adds a new field with a unique default identifier.
   *
   * Generates identifiers following the pattern:
   * - First field: "input" or "output"
   * - Subsequent fields: "input_1", "input_2", etc.
   *
   * This prevents Zod validation errors that require non-empty identifiers.
   */
  const handleAddField = () => {
    const currentFields = getValues(fieldArrayName);
    const baseName = name === "inputs" ? "input" : "output";
    const existingIdentifiers = Array.isArray(currentFields)
      ? currentFields.map((f) => f.identifier)
      : [];

    const identifier = generateUniqueIdentifier({
      baseName,
      existingIdentifiers,
    });

    append({ identifier, type: "str" });
  };

  const handleSetValue = (path: string, value: any) => {
    setValue(path as any, value, { shouldValidate: false });
  };

  /**
   * Validates that field identifiers are unique within the field group.
   *
   * @param index - Index of the field being validated
   * @param value - Identifier value to check for duplicates
   * @returns true if valid, or error message string if duplicate found
   */
  const validateIdentifier = (index: number, value: string) => {
    const currentFields = getValues(fieldArrayName);
    const fieldArrayIdentifierPath =
      `${fieldArrayName}.${index}.identifier` as const;

    if (Array.isArray(currentFields)) {
      const identifierCount = currentFields.filter(
        (f, i) => f.identifier === value && i !== index,
      ).length;

      if (identifierCount > 0) {
        setValue(fieldArrayIdentifierPath, value, {
          shouldValidate: true,
        });
        return "Duplicate identifier";
      }
    }

    return true;
  };

  return (
    <VStack align="start" gap={3} width="full">
      <FieldGroupHeader
        title={title}
        onAdd={handleAddField}
        readOnly={readOnly}
      />

      {fields.map((field, index) => (
        <FieldRow
          key={field.id}
          field={field}
          index={index}
          name={name}
          onChange={handleSetValue}
          onRemove={() => remove(index)}
          readOnly={readOnly}
          totalFields={fields.length}
          // error={errors[`version.${name}`]?.[index]?.identifier}
          validateIdentifier={(value) => validateIdentifier(index, value)}
        />
      ))}
    </VStack>
  );
}

/**
 * FieldGroupHeader
 * Single Responsibility: Renders the header section with title and add button for a field group.
 *
 * @param title - Display title for the field group
 * @param onAdd - Callback to add a new field
 * @param readOnly - If true, hides the add button
 */
function FieldGroupHeader({
  title,
  onAdd,
  readOnly,
}: {
  title: string;
  onAdd: () => void;
  readOnly?: boolean;
}) {
  return (
    <HStack width="full">
      <PropertySectionTitle>{title}</PropertySectionTitle>
      <Spacer />
      {!readOnly && (
        <Button size="xs" variant="ghost" onClick={onAdd}>
          <Plus size={16} />
        </Button>
      )}
    </HStack>
  );
}

/**
 * FieldRow
 * Single Responsibility: Renders a single field row with identifier input, type selector, and delete button.
 *
 * Implements business logic to prevent deleting the last output field:
 * - Outputs require at least one field (schema: min(1))
 * - Inputs can be deleted freely (no minimum requirement)
 * - Delete button is disabled (not hidden) for discoverability with tooltip explanation
 *
 * @param field - Field data from react-hook-form's useFieldArray
 * @param index - Position in the field array
 * @param name - Field type: "inputs" or "outputs"
 * @param onChange - Callback to update field values
 * @param onRemove - Callback to remove this field
 * @param readOnly - If true, shows read-only view and hides delete button
 * @param error - Validation error to display
 * @param validateIdentifier - Function to check for duplicate identifiers
 * @param totalFields - Total number of fields in the group (used for delete button logic)
 */
function FieldRow({
  field,
  index,
  name,
  onChange,
  onRemove,
  readOnly,
  error,
  validateIdentifier,
  totalFields,
}: {
  field: { id: string; identifier: string; type: string };
  index: number;
  name: "inputs" | "outputs";
  onChange: (indexOrPath: string, value: any) => void;
  onRemove: () => void;
  readOnly?: boolean;
  error?: { message?: string };
  validateIdentifier: (value: string) => true | string;
  totalFields: number;
}) {
  const { getValues } = useFormContext();
  const fieldIdBase = `version.configData.${name}.${index}`;
  const identifierFieldId = `${fieldIdBase}.identifier`;
  const typeFieldId = `${fieldIdBase}.type`;
  const jsonSchemaFieldId = `${fieldIdBase}.json_schema`;

  const currentIdentifier =
    getValues(identifierFieldId) ?? field.identifier ?? "";
  const currentType = getValues(typeFieldId) ?? field.type ?? "str";
  const currentJsonSchema = getValues(jsonSchemaFieldId);

  return (
    <Field.Root key={field.id} invalid={!!error}>
      <HStack width="full">
        <HStack
          background="gray.100"
          paddingRight={2}
          borderRadius="8px"
          width="full"
        >
          {!readOnly ? (
            <Input
              name={identifierFieldId}
              onChange={(e) => {
                const normalized = e.target.value
                  .replace(/ /g, "_")
                  .toLowerCase();

                onChange(identifierFieldId, normalized);
              }}
              onBlur={(e) => {
                validateIdentifier(e.target.value);
              }}
              value={currentIdentifier}
              width="full"
              fontFamily="monospace"
              fontSize="13px"
              border="none"
              background="transparent"
              padding="6px 0px 6px 12px"
            />
          ) : (
            <Text
              fontFamily="monospace"
              fontSize="13px"
              width="full"
              padding="8px 0px 8px 12px"
            >
              {currentIdentifier}
            </Text>
          )}
          <TypeSelector
            name={typeFieldId}
            value={currentType}
            jsonSchema={currentJsonSchema}
            onChange={(value, jsonSchema) => {
              onChange(typeFieldId, value);
              onChange(jsonSchemaFieldId, jsonSchema);
            }}
            isInput={name === "inputs"}
            readOnly={readOnly}
          />
        </HStack>
        {!readOnly && (
          <Tooltip
            content={
              name === "outputs" && totalFields === 1
                ? "At least one output is required"
                : undefined
            }
            disabled={!(name === "outputs" && totalFields === 1)}
            positioning={{ placement: "top" }}
            showArrow
          >
            <Button
              colorPalette="gray"
              size="sm"
              height="40px"
              onClick={onRemove}
              disabled={name === "outputs" && totalFields === 1}
            >
              <Trash2 size={18} />
            </Button>
          </Tooltip>
        )}
      </HStack>
      {error?.message && <Field.ErrorText>{error.message}</Field.ErrorText>}
    </Field.Root>
  );
}

export function InputsFieldGroup() {
  return <ConfigFieldGroup title="Inputs" name="inputs" />;
}

export function OutputsFieldGroup() {
  return <ConfigFieldGroup title="Outputs" name="outputs" />;
}
