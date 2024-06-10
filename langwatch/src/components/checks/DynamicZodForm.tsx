import {
  Box,
  Button,
  FormLabel,
  HStack,
  Input,
  Select,
  Switch,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import React from "react";
import {
  Controller,
  useFieldArray,
  useFormContext,
  type FieldErrors,
} from "react-hook-form";
import { z, type ZodType } from "zod";
import type {
  EvaluatorDefinition,
  EvaluatorTypes,
  Evaluators,
} from "../../trace_checks/evaluators.generated";
import { getEvaluatorDefinitions } from "../../trace_checks/getEvaluator";
import { camelCaseToTitleCase, titleCase } from "../../utils/stringCasing";
import { HorizontalFormControl } from "../HorizontalFormControl";
import type { CheckConfigFormData } from "./CheckConfigForm";
import { X } from "react-feather";
import { SmallLabel } from "../SmallLabel";
import { ModelSelector } from "../ModelSelector";

const DynamicZodForm = ({
  schema,
  checkType: evaluatorType,
  prefix,
  errors,
}: {
  schema: ZodType;
  checkType: EvaluatorTypes;
  prefix: string;
  errors: FieldErrors<CheckConfigFormData>["settings"];
}) => {
  const { control, register } = useFormContext();

  const renderField = <T extends EvaluatorTypes>(
    fieldSchema: ZodType,
    fieldName: string,
    evaluator: EvaluatorDefinition<T> | undefined
  ): React.JSX.Element | null => {
    const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
    const defaultValue =
      evaluator?.settings?.[fieldName as keyof Evaluators[T]["settings"]]
        ?.default;

    const fieldSchema_ =
      fieldSchema instanceof z.ZodOptional ? fieldSchema.unwrap() : fieldSchema;

    const fieldKey = fieldName.split(".").reverse()[0] ?? "";

    if (fieldSchema_ instanceof z.ZodString) {
      if (["topic", "name"].includes(fieldKey) || !isNaN(+fieldKey)) {
        return <Input {...register(fullPath)} />;
      }
      return <Textarea {...register(fullPath)} />;
    } else if (fieldSchema_ instanceof z.ZodNumber) {
      return (
        <Input
          type="number"
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
        <HStack width="full" spacing={2}>
          <Controller
            name={fullPath}
            control={control}
            render={({ field: { onChange, onBlur, value, name, ref } }) => (
              <Switch
                id={fullPath}
                isChecked={value}
                onChange={onChange}
                onBlur={onBlur}
                name={name}
                ref={ref}
              />
            )}
          />
          <FormLabel htmlFor={fullPath} mb="0">
            {camelCaseToTitleCase(fieldName.split(".").reverse()[0] ?? "")}
          </FormLabel>
        </HStack>
      );
    } else if (fieldSchema_ instanceof z.ZodUnion) {
      if (fieldName === "model") {
        return (
          <Controller
            name={fullPath}
            control={control}
            render={({ field }) => (
              <ModelSelector
                options={fieldSchema_.options.map(
                  (option: { value: string }) => option.value
                )}
                model={field.value}
                onChange={(model) => field.onChange(model)}
              />
            )}
          />
        );
      }

      return (
        <Controller
          name={fullPath}
          control={control}
          render={({ field }) => (
            <Select
              {...field}
              onChange={(e) => {
                const literalValues = fieldSchema_.options.map(
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
              {fieldSchema_.options.map(
                (option: { value: string }, index: number) => (
                  <option key={index} value={option.value}>
                    {option.value}
                  </option>
                )
              )}
            </Select>
          )}
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
          {fields.map((field, index) => (
            <Box
              key={field.id}
              borderLeft={
                fieldSchema_.element instanceof z.ZodObject
                  ? "4px solid"
                  : undefined
              }
              borderLeftColor="orange.400"
              width="full"
            >
              <HStack
                borderLeftColor="reset"
                padding={fieldSchema_.element instanceof z.ZodObject ? 3 : 0}
                paddingRight={3}
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
                  <X />
                </Button>
                <Box width="95%">
                  {renderField(
                    fieldSchema_.element,
                    `${fieldName}.${index}`,
                    evaluator
                  )}
                </Box>
              </HStack>
            </Box>
          ))}
          <Button onClick={() => append(defaultValues)}>Add</Button>
        </VStack>
      );
    } else if (fieldSchema_ instanceof z.ZodObject) {
      return (
        <VStack width="full" spacing={2}>
          {Object.keys(fieldSchema_.shape).map((key) => (
            <VStack key={key} align="start" width="full">
              {!(fieldSchema_.shape[key] instanceof z.ZodBoolean) && (
                <SmallLabel>{titleCase(key)}</SmallLabel>
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

      return Object.keys(schema.shape).map((key) => {
        const field = schema.shape[key];
        const isOptional = field instanceof z.ZodOptional;

        if (evaluatorType === "huggingface/llama_guard" && key === "model") {
          return null;
        }

        return (
          <React.Fragment key={key}>
            <HorizontalFormControl
              label={
                camelCaseToTitleCase(key) + (isOptional ? " (Optional)" : "")
              }
              helper={
                evaluatorDefinition?.settings?.[
                  key as keyof Evaluators[T]["settings"]
                ].description ?? ""
              }
              isInvalid={errors && key in errors && !!(errors as any)[key]}
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
