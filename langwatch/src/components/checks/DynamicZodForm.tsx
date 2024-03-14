import {
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
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { z, type ZodType } from "zod";
import type {
  EvaluatorDefinition,
  EvaluatorTypes,
  Evaluators,
} from "../../trace_checks/evaluators.generated";
import { getEvaluatorDefinitions } from "../../trace_checks/getEvaluator";
import { camelCaseToTitleCase } from "../../utils/stringCasing";
import { HorizontalFormControl } from "../HorizontalFormControl";

const DynamicZodForm = ({
  schema,
  checkType,
  prefix,
}: {
  schema: ZodType;
  checkType: EvaluatorTypes;
  prefix: string;
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

    if (fieldSchema_ instanceof z.ZodString) {
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
      return (
        <Controller
          name={fullPath}
          control={control}
          render={({ field }) => (
            <Select {...field}>
              {fieldSchema instanceof z.ZodOptional && (
                <option value={undefined}></option>
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
      return (
        <VStack>
          {fields.map((field, index) => (
            <HStack key={field.id}>
              {renderField(
                fieldSchema_.element,
                `${fieldName}.${index}`,
                evaluator
              )}
              <Button onClick={() => remove(index)}>Remove</Button>
            </HStack>
          ))}
          <Button onClick={() => append({})}>Add</Button>
        </VStack>
      );
    } else if (fieldSchema_ instanceof z.ZodObject) {
      return (
        <VStack spacing={2}>
          {Object.keys(fieldSchema_.shape).map((key) => (
            <React.Fragment key={key}>
              {renderField(
                fieldSchema_.shape[key],
                `${fieldName}.${key}`,
                evaluator
              )}
            </React.Fragment>
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
      const checkDefinition = getEvaluatorDefinitions(
        checkType
      ) as EvaluatorDefinition<T>;

      return Object.keys(schema.shape).map((key) => {
        const field = schema.shape[key];
        const isOptional = field instanceof z.ZodOptional;

        return (
          <React.Fragment key={key}>
            <HorizontalFormControl
              label={
                camelCaseToTitleCase(key) + (isOptional ? " (Optional)" : "")
              }
              helper={
                checkDefinition?.settings?.[
                  key as keyof Evaluators[T]["settings"]
                ].description ?? ""
              }
            >
              {renderField(
                field,
                basePath ? `${basePath}.${key}` : key,
                checkDefinition
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
