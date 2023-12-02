import React from "react";
import { type ZodType, z } from "zod";
import { useFormContext, useFieldArray, Controller } from "react-hook-form";
import { Button, Input, Select, VStack, HStack } from "@chakra-ui/react";
import { SettingsFormControl } from "./SettingsLayout";
import { camelCaseToTitleCase } from "../utils/stringCasing";
import type { CheckTypes } from "../trace_checks/types";

const parametersDescription: Record<
  CheckTypes,
  Record<string, { name?: string; description?: string }>
> = {
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
  },
  toxicity_check: {},
  custom: {},
};

const DynamicZodForm = ({
  schema,
  prefix,
}: {
  schema: ZodType;
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
      return <Input type="number" {...register(fullPath)} />;
    } else if (fieldSchema instanceof z.ZodUnion) {
      return (
        <Controller
          name={fullPath}
          control={control}
          render={({ field }) => (
            <Select {...field}>
              {fieldSchema.options.map((option, index) => (
                <option key={index} value={option.value}>
                  {option.value}
                </option>
              ))}
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
        <>
          {Object.keys(fieldSchema.shape).map((key) => (
            <React.Fragment key={key}>
              {renderField(fieldSchema.shape[key], `${fieldName}.${key}`)}
            </React.Fragment>
          ))}
        </>
      );
    }

    return null;
  };

  const renderSchema = (schema: ZodType, basePath = "") => {
    if (schema instanceof z.ZodObject) {
      return Object.keys(schema.shape).map((key) => (
        <React.Fragment key={key}>
          <SettingsFormControl
            label={
              parametersDescription[prefix as CheckTypes]?.[key]?.name ??
              camelCaseToTitleCase(key)
            }
            helper={
              parametersDescription[prefix as CheckTypes]?.[key]?.description ??
              ""
            }
          >
            {renderField(
              schema.shape[key],
              basePath ? `${basePath}.${key}` : key
            )}
          </SettingsFormControl>
        </React.Fragment>
      ));
    }
    return null;
  };

  return <>{renderSchema(schema)}</>;
};

export default DynamicZodForm;
