import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Trash2 } from "react-feather";
import { TypeSelector } from "../ui/TypeSelector";
import {
  type EnhancedFieldArrayWithId,
  type PromptConfigContentFormValues,
  promptConfigContentSchema,
} from "../types";

/**
 * Dumb Form Component for editing the config content
 */
export function PromptConfigVersionForm({
  initialValues,
  onSubmit,
  readOnly = false,
}: {
  initialValues: Partial<PromptConfigContentFormValues>;
  onSubmit: (values: PromptConfigContentFormValues) => void;
  isSubmitting: boolean;
  submitLabel?: string;
  readOnly?: boolean;
}) {
  // Form setup with schema validation
  const form = useForm<PromptConfigContentFormValues>({
    resolver: zodResolver(promptConfigContentSchema),
    defaultValues: {
      name: initialValues.name || "",
      description: initialValues.description || "",
      prompt: initialValues.prompt || "You are a helpful assistant",
      model: initialValues.model || "openai/gpt4-o-mini",
      inputs: initialValues.inputs || [{ identifier: "input", type: "str" }],
      outputs: initialValues.outputs || [{ identifier: "output", type: "str" }],
    },
  });

  const { handleSubmit, register, formState } = form;
  const { errors } = formState;

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack align="stretch" gap={6}>
        <Field.Root invalid={!!errors.model}>
          <Field.Label>Model</Field.Label>
          <Input
            {...register("model")}
            placeholder="openai/gpt4-o-mini"
            readOnly={readOnly}
          />
          {errors.model && (
            <Field.ErrorText>{errors.model.message}</Field.ErrorText>
          )}
        </Field.Root>

        <Field.Root invalid={!!errors.prompt}>
          <Field.Label>Prompt</Field.Label>
          <Textarea
            {...register("prompt")}
            placeholder="You are a helpful assistant"
            rows={4}
            readOnly={readOnly}
          />
          {errors.prompt && (
            <Field.ErrorText>{errors.prompt.message}</Field.ErrorText>
          )}
        </Field.Root>

        <ConfigFieldGroup
          title="Inputs"
          name="inputs"
          form={form}
          readOnly={readOnly}
        />

        <ConfigFieldGroup
          title="Outputs"
          name="outputs"
          form={form}
          readOnly={readOnly}
        />
      </VStack>
    </form>
  );
}

/**
 * Reusable component for a group of fields (inputs, outputs)
 */
function ConfigFieldGroup({
  title,
  name,
  form,
  readOnly,
}: {
  title: string;
  name: "inputs" | "outputs";
  form: UseFormReturn<PromptConfigContentFormValues>;
  readOnly?: boolean;
}) {
  const { control, formState, setValue, getValues } = form;
  const { errors } = formState;

  const { fields, append, remove } = useFieldArray({
    control,
    name,
  });

  const handleAddField = () => {
    append({ identifier: "", type: "str" });
  };

  const handleSetValue = (path: string, value: any) => {
    setValue(path as any, value, { shouldValidate: true });
  };

  const validateIdentifier = (index: number, value: string) => {
    const currentFields = getValues(name);

    if (Array.isArray(currentFields)) {
      const identifierCount = currentFields.filter(
        (f, i) => f.identifier === value && i !== index
      ).length;

      if (identifierCount > 0) {
        setValue(`${name}.${index}.identifier` as any, value, {
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
          field={field as unknown as EnhancedFieldArrayWithId}
          index={index}
          name={name}
          onChange={handleSetValue}
          onRemove={() => remove(index)}
          readOnly={readOnly}
          error={(errors[name] as any)?.[index]?.identifier}
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
  field: EnhancedFieldArrayWithId;
  index: number;
  name: "inputs" | "outputs";
  onChange: (indexOrPath: string, value: any) => void;
  onRemove: () => void;
  readOnly?: boolean;
  error?: { message?: string };
  validateIdentifier: (value: string) => true | string;
}) {
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
              name={`${name}.${index}.identifier`}
              onChange={(e) => {
                const normalized = e.target.value
                  .replace(/ /g, "_")
                  .toLowerCase();
                onChange(`${name}.${index}.identifier`, normalized);
              }}
              onBlur={(e) => {
                validateIdentifier(e.target.value);
              }}
              defaultValue={field.identifier || ""}
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
              {field.identifier}
            </Text>
          )}
          <TypeSelector
            name={`${name}.${index}.type`}
            value={field.type || "str"}
            onChange={(value) => onChange(`${name}.${index}.type`, value)}
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
