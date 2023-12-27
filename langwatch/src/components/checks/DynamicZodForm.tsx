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
import type { CheckTypes, Checks } from "../../trace_checks/types";
import { camelCaseToTitleCase } from "../../utils/stringCasing";
import { HorizontalFormControl } from "../HorizontalFormControl";

const parametersDescription: {
  [K in CheckTypes]: Record<
    keyof Checks[K]["parameters"],
    { name?: string; description?: string }
  >;
} = {
  pii_check: {
    infoTypes: {
      name: "PII types to check",
      description: "The types of PII that are relevant to check for",
    },
    minLikelihood: {
      name: "PII probability threshold",
      description:
        "The minimum confidence that a PII was found to fail the check",
    },
    checkPiiInSpans: {
      name: "Fail for PII in spans",
      description:
        "Whether this check fail is PII is identified in the inner spans of a message, or just in the final input and output",
    },
  },
  toxicity_check: {
    categories: {
      name: "Categories to check",
      description: "The categories of moderation to check for",
    },
  },
  custom: {
    rules: {},
  },
  jailbreak_check: {},
  inconsistency_check: {},
};

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

  const renderField = (
    fieldSchema: ZodType,
    fieldName: string
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
                    {option.value}
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
              {renderField(fieldSchema.element, `${fieldName}.${index}`)}
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
              {renderField(fieldSchema.shape[key], `${fieldName}.${key}`)}
            </React.Fragment>
          ))}
        </VStack>
      );
    }

    return null;
  };

  const renderSchema = (schema: ZodType, basePath = "") => {
    if (schema instanceof z.ZodObject) {
      return Object.keys(schema.shape).map((key) => (
        <React.Fragment key={key}>
          <HorizontalFormControl
            label={
              (parametersDescription as any)[checkType]?.[key]?.name ??
              camelCaseToTitleCase(key)
            }
            helper={
              (parametersDescription as any)[checkType]?.[key]?.description ??
              ""
            }
          >
            {renderField(
              schema.shape[key],
              basePath ? `${basePath}.${key}` : key
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
