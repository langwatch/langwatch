import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import React from "react";
import { Info, Plus, Trash2, X } from "react-feather";
import {
  Controller,
  useFieldArray,
  useFormContext,
  type FieldErrors,
} from "react-hook-form";
import { z, type ZodType } from "zod";
import { PropertySectionTitle } from "../../optimization_studio/components/properties/BasePropertiesPanel";
import type {
  EvaluatorDefinition,
  Evaluators,
  EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import { camelCaseToTitleCase, titleCase } from "../../utils/stringCasing";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { allModelOptions, ModelSelector } from "../ModelSelector";
import { SmallLabel } from "../SmallLabel";
import { Tooltip } from "../ui/tooltip";
import { Switch } from "../ui/switch";
import type { CheckConfigFormData } from "./CheckConfigForm";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { DEFAULT_EMBEDDINGS_MODEL, DEFAULT_MODEL } from "../../utils/constants";

const DynamicZodForm = ({
  schema,
  evaluatorType,
  prefix,
  errors,
  variant = "default",
  onlyFields,
  skipFields,
}: {
  schema: ZodType;
  evaluatorType: EvaluatorTypes;
  prefix: string;
  errors: FieldErrors<CheckConfigFormData>["settings"];
  variant?: "default" | "studio";
  onlyFields?: string[];
  skipFields?: string[];
}) => {
  const { control, register } = useFormContext();
  const { project } = useOrganizationTeamProject();

  const renderField = <T extends EvaluatorTypes>(
    fieldSchema: ZodType,
    fieldName: string,
    evaluator: EvaluatorDefinition<T> | undefined
  ): React.JSX.Element | null => {
    const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
    let defaultValue =
      evaluator?.settings?.[fieldName as keyof Evaluators[T]["settings"]]
        ?.default;

    if (fieldName === "model") {
      defaultValue = (project?.defaultModel ?? DEFAULT_MODEL) as any;
    }
    if (fieldName === "embeddings_model") {
      defaultValue = (project?.embeddingsModel ??
        DEFAULT_EMBEDDINGS_MODEL) as any;
    }

    const fieldSchema_ =
      fieldSchema instanceof z.ZodOptional ? fieldSchema.unwrap() : fieldSchema;

    const fieldKey = fieldName.split(".").reverse()[0] ?? "";

    if (fieldSchema_ instanceof z.ZodDefault) {
      return renderField(fieldSchema_._def.innerType, fieldName, evaluator);
    } else if (fieldSchema_ instanceof z.ZodNumber) {
      return (
        <Input
          type="number"
          size={variant === "studio" ? "sm" : "md"}
          step={
            typeof defaultValue === "number" &&
            Math.round(defaultValue) != defaultValue
              ? "0.01"
              : "1"
          }
          {...register(fullPath, { setValueAs: (val) => +val })}
        />
      );
    } else if (fieldSchema_ instanceof z.ZodBoolean) {
      return (
        <Field.Root>
          <HStack width="full" gap={2}>
            <Controller
              name={fullPath}
              control={control}
              render={({ field: { onChange, onBlur, value, name, ref } }) => (
                <Switch
                  id={fullPath}
                  checked={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  name={name}
                  ref={ref}
                  size={variant === "studio" ? "sm" : "md"}
                  paddingLeft={variant === "studio" ? 2 : undefined}
                />
              )}
            />
            <Field.Label
              htmlFor={fullPath}
              marginBottom="0"
              fontWeight={variant === "studio" ? 400 : undefined}
              fontSize={variant === "studio" ? "13px" : undefined}
            >
              {camelCaseToTitleCase(fieldName.split(".").reverse()[0] ?? "")}
            </Field.Label>
          </HStack>
        </Field.Root>
      );
    } else if (
      fieldSchema_ instanceof z.ZodUnion ||
      fieldSchema_ instanceof z.ZodLiteral ||
      (fieldSchema_ instanceof z.ZodString &&
        (fieldName === "model" || fieldName === "embeddings_model"))
    ) {
      const options =
        fieldSchema_ instanceof z.ZodUnion
          ? fieldSchema_.options
          : fieldSchema_ instanceof z.ZodLiteral
          ? [{ value: fieldSchema_.value }]
          : allModelOptions.map((option) => ({ value: option }));
      if (
        (fieldName === "model" || fieldName === "embeddings_model") &&
        evaluator?.name !== "OpenAI Moderation"
      ) {
        const selectorOptions =
          fieldName === "model"
            ? options.map((option: { value: string }) => option.value)
            : options.map((option: { value: string }) => option.value);

        return (
          <Controller
            name={fullPath}
            control={control}
            render={({ field }) => (
              <>
                <ModelSelector
                  options={selectorOptions}
                  model={field.value}
                  onChange={(model) => field.onChange(model)}
                  mode={fieldName === "model" ? "chat" : "embedding"}
                  size={variant === "studio" ? "sm" : "md"}
                />
              </>
            )}
          />
        );
      }

      return (
        <Controller
          name={fullPath}
          control={control}
          render={({ field }) => (
            <NativeSelect.Root size={variant === "studio" ? "sm" : "md"}>
              <NativeSelect.Field
                {...field}
                onChange={(e) => {
                  const literalValues = options.map(
                    (option: any) => option.value
                  );

                  if (e.target.value === "") {
                    field.onChange(undefined);
                  } else if (
                    !isNaN(+e.target.value) &&
                    literalValues.includes(+e.target.value)
                  ) {
                    field.onChange(+e.target.value);
                  } else {
                    field.onChange(e.target.value);
                  }
                }}
              >
                {fieldSchema instanceof z.ZodOptional && (
                  <option value=""></option>
                )}
                {options.map((option: { value: string }, index: number) => (
                  <option key={index} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          )}
        />
      );
    } else if (fieldSchema_ instanceof z.ZodString) {
      if (["topic", "name"].includes(fieldKey) || !isNaN(+fieldKey)) {
        return (
          <Input
            size={variant === "studio" ? "sm" : "md"}
            {...register(fullPath)}
          />
        );
      }
      return (
        <Textarea
          size={variant === "studio" ? "sm" : "md"}
          {...register(fullPath)}
        />
      );
    } else if (fieldSchema_ instanceof z.ZodArray) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { fields, append, remove } = useFieldArray({
        control,
        name: fullPath,
      });

      const defaultValues =
        fieldSchema_.element instanceof z.ZodObject
          ? Object.fromEntries(
              Object.entries(fieldSchema_.element.shape).flatMap(
                ([key, value]) => {
                  if (value instanceof z.ZodUnion) {
                    const defaultValue = value.options[0].value;
                    return [[key, defaultValue]];
                  }

                  return [];
                }
              )
            )
          : {};

      return (
        <VStack align="start" width="full">
          {variant === "studio" && (
            <Button
              position="absolute"
              right={0}
              top="-36px"
              padding={0}
              size="sm"
              variant="ghost"
              onClick={() => append(defaultValues)}
            >
              <Plus size={16} />
            </Button>
          )}
          {fields.map((field, index) => (
            <Box
              key={field.id}
              borderLeft={
                fieldSchema_.element instanceof z.ZodObject
                  ? "4px solid"
                  : undefined
              }
              borderLeftColor={variant === "studio" ? "gray.200" : "orange.400"}
              width="full"
            >
              <HStack
                borderLeftColor="reset"
                padding={fieldSchema_.element instanceof z.ZodObject ? 3 : 0}
                paddingRight={variant === "studio" ? 0 : 3}
                width="full"
                align="start"
                position="relative"
              >
                <Button
                  position="absolute"
                  right={0}
                  top={0}
                  padding={0}
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(index)}
                  color="gray.400"
                >
                  {variant === "studio" ? (
                    <Trash2 size={14} />
                  ) : (
                    <X size={18} />
                  )}
                </Button>
                <Box width={variant === "studio" ? "100%" : "95%"}>
                  {renderField(
                    fieldSchema_.element,
                    `${fieldName}.${index}`,
                    evaluator
                  )}
                </Box>
              </HStack>
            </Box>
          ))}
          {variant !== "studio" && (
            <Button onClick={() => append(defaultValues)}>Add</Button>
          )}
        </VStack>
      );
    } else if (fieldSchema_ instanceof z.ZodObject) {
      return (
        <VStack width="full" gap={2}>
          {Object.keys(fieldSchema_.shape).map((key) => (
            <VStack key={key} align="start" width="full">
              {!(fieldSchema_.shape[key] instanceof z.ZodBoolean) && (
                <SmallLabel>
                  {fieldName.startsWith("rubrics.")
                    ? `Level ${parseInt(fieldName.split(".")[1] ?? "0") + 1}`
                    : titleCase(key)}
                </SmallLabel>
              )}
              {renderField(
                fieldSchema_.shape[key],
                `${fieldName}.${key}`,
                evaluator
              )}
            </VStack>
          ))}
        </VStack>
      );
    }

    return null;
  };

  const renderSchema = <T extends EvaluatorTypes>(
    schema: ZodType<Evaluators[T]["settings"]>,
    basePath = ""
  ) => {
    if (schema instanceof z.ZodObject) {
      const evaluatorDefinition = getEvaluatorDefinitions(
        evaluatorType
      ) as EvaluatorDefinition<T>;

      return Object.keys(schema.shape)
        .filter((key) => !skipFields?.includes(key))
        .filter((key) => (onlyFields ? onlyFields.includes(key) : true))
        .map((key) => {
          const field = schema.shape[key];
          const isOptional = field instanceof z.ZodOptional;
          const helperText =
            evaluatorDefinition?.settings?.[
              key as keyof Evaluators[T]["settings"]
            ].description ?? "";
          const isInvalid = errors && key in errors && !!(errors as any)[key];

          if (variant === "studio") {
            return (
              <VStack key={key} as="form" align="start" gap={3} width="full">
                <HStack width="full">
                  <PropertySectionTitle>
                    {camelCaseToTitleCase(key)}
                  </PropertySectionTitle>
                  {isOptional && (
                    <Text color="gray.500" fontSize="12px">
                      (optional)
                    </Text>
                  )}
                  {helperText && (
                    <Tooltip
                      content={helperText}
                      positioning={{ placement: "top" }}
                    >
                      <Info size={14} />
                    </Tooltip>
                  )}
                </HStack>
                <Field.Root invalid={isInvalid}>
                  {renderField(
                    field,
                    basePath ? `${basePath}.${key}` : key,
                    evaluatorDefinition
                  )}
                </Field.Root>
              </VStack>
            );
          }

          return (
            <React.Fragment key={key}>
              <HorizontalFormControl
                label={
                  camelCaseToTitleCase(key) + (isOptional ? " (Optional)" : "")
                }
                helper={helperText}
                invalid={isInvalid}
              >
                {renderField(
                  field,
                  basePath ? `${basePath}.${key}` : key,
                  evaluatorDefinition
                )}
              </HorizontalFormControl>
            </React.Fragment>
          );
        });
    }
    return null;
  };

  return <>{renderSchema(schema)}</>;
};

export default DynamicZodForm;
