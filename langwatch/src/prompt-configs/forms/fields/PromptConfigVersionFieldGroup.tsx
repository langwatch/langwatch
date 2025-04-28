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
import { Trash2 } from "react-feather";
import { useFieldArray, useFormContext } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";
import { TypeSelector } from "../../ui/TypeSelector";

/**
 * Reusable component for a group of fields (inputs, outputs)
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

  const handleAddField = () => {
    append({ identifier: "", type: "str" });
  };

  const handleSetValue = (path: string, value: any) => {
    setValue(path as any, value, { shouldValidate: false });
  };

  const validateIdentifier = (index: number, value: string) => {
    const currentFields = getValues(fieldArrayName);
    const fieldArrayIdentifierPath =
      `${fieldArrayName}.${index}.identifier` as const;

    if (Array.isArray(currentFields)) {
      const identifierCount = currentFields.filter(
        (f, i) => f.identifier === value && i !== index
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
          // error={errors[`version.${name}`]?.[index]?.identifier}
          validateIdentifier={(value) => validateIdentifier(index, value)}
        />
      ))}
    </VStack>
  );
}

/**
 * Header for a field group with title and add button
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
      <Text fontSize="sm" fontWeight="semibold">
        {title}
      </Text>
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
 * A single field row with identifier and type
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
}: {
  field: { id: string; identifier: string; type: string };
  index: number;
  name: "inputs" | "outputs";
  onChange: (indexOrPath: string, value: any) => void;
  onRemove: () => void;
  readOnly?: boolean;
  error?: { message?: string };
  validateIdentifier: (value: string) => true | string;
}) {
  const { getValues } = useFormContext();
  const fieldIdBase = `version.configData.${name}.${index}`;
  const identifierFieldId = `${fieldIdBase}.identifier`;
  const typeFieldId = `${fieldIdBase}.type`;

  const currentIdentifier =
    getValues(identifierFieldId) ?? field.identifier ?? "";
  const currentType = getValues(typeFieldId) ?? field.type ?? "str";

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
            onChange={(value) => {
              onChange(typeFieldId, value);
            }}
            isInput={name === "inputs"}
            readOnly={readOnly}
          />
        </HStack>
        {!readOnly && (
          <Button
            colorPalette="gray"
            size="sm"
            height="40px"
            onClick={onRemove}
          >
            <Trash2 size={18} />
          </Button>
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
