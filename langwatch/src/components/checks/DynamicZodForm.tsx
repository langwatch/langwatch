import {
  Button,
  FormLabel,
  HStack,
  Input,
  Select,
  Switch,
  VStack,
} from "@chakra-ui/react";
import React from "react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import { z, type ZodType } from "zod";
import { camelCaseToTitleCase } from "../../utils/stringCasing";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { getTraceCheckDefinitions } from "../../trace_checks/registry";
import type {
  CheckTypes,
  Checks,
  TraceCheckDefinition,
} from "../../trace_checks/types";

const DynamicZodForm = ({
  schema,
  checkType,
  prefix,
}: {
  schema: ZodType;
  checkType: string;
  prefix: string;
}) => {
  const { control, register } = useFormContext();

  const renderField = <T extends CheckTypes>(
    fieldSchema: ZodType,
    fieldName: string,
    checkDefinition: TraceCheckDefinition<T> | undefined
  ): React.JSX.Element | null => {
    const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;

    if (fieldSchema instanceof z.ZodString) {
      return <Input {...register(fullPath)} />;
    } else if (fieldSchema instanceof z.ZodNumber) {
      return (
        <Input
          type="number"
          {...register(fullPath, { setValueAs: (val) => +val })}
        />
      );
    } else if (fieldSchema instanceof z.ZodBoolean) {
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
    } else if (fieldSchema instanceof z.ZodUnion) {
      return (
        <Controller
          name={fullPath}
          control={control}
          render={({ field }) => (
            <Select {...field}>
              {fieldSchema.options.map(
                (option: { value: string }, index: number) => (
                  <option key={index} value={option.value}>
                    {(
                      checkDefinition?.parametersDescription[
                        fieldName as keyof Checks[T]["parameters"]
                      ]?.labels as any
                    )?.[option.value] ?? option.value}
                  </option>
                )
              )}
            </Select>
          )}
        />
      );
    } else if (fieldSchema instanceof z.ZodArray) {
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
                fieldSchema.element,
                `${fieldName}.${index}`,
                checkDefinition
              )}
              <Button onClick={() => remove(index)}>Remove</Button>
            </HStack>
          ))}
          <Button onClick={() => append({})}>Add</Button>
        </VStack>
      );
    } else if (fieldSchema instanceof z.ZodObject) {
      return (
        <VStack spacing={2}>
          {Object.keys(fieldSchema.shape).map((key) => (
            <React.Fragment key={key}>
              {renderField(
                fieldSchema.shape[key],
                `${fieldName}.${key}`,
                checkDefinition
              )}
            </React.Fragment>
          ))}
        </VStack>
      );
    }

    return null;
  };

  const renderSchema = (schema: ZodType, basePath = "") => {
    if (schema instanceof z.ZodObject) {
      const checkDefinition = getTraceCheckDefinitions(checkType);

      return Object.keys(schema.shape).map((key) => (
        <React.Fragment key={key}>
          <HorizontalFormControl
            label={
              (checkDefinition?.parametersDescription as any)?.[key]?.name ??
              camelCaseToTitleCase(key)
            }
            helper={
              (checkDefinition?.parametersDescription as any)?.[key]
                ?.description ?? ""
            }
          >
            {renderField(
              schema.shape[key],
              basePath ? `${basePath}.${key}` : key,
              checkDefinition
            )}
          </HorizontalFormControl>
        </React.Fragment>
      ));
    }
    return null;
  };

  return <>{renderSchema(schema)}</>;
};

export default DynamicZodForm;
