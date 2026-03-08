import {
  Box,
  Button,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { X } from "react-feather";
import { useFormContext } from "react-hook-form";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import type {
  CheckPreconditionFields,
  CheckPreconditionRule,
} from "../../server/evaluations/types";
import { HorizontalFormControl } from "../HorizontalFormControl";
import {
  RULE_LABELS,
  getAllowedRulesForField,
  getFieldOptionsByCategory,
  getFieldValueType,
  isRuleAllowedForField,
} from "../preconditions/preconditionFieldUtils";
import { SmallLabel } from "../SmallLabel";

export const PreconditionsField = ({
  runOn,
  append,
  remove,
  fields,
  label = "Preconditions",
  helper = "Conditions that must be met for this check to run",
}: {
  runOn: React.ReactNode | null;
  append: (value: any) => void;
  remove: (index: number) => void;
  fields: Record<"id", string>[];
  label?: string | React.ReactNode;
  helper?: string | React.ReactNode;
}) => {
  const { control, watch, setValue, formState } = useFormContext();
  const preconditions = watch("preconditions");
  const checkType = watch("checkType");

  const evaluator = getEvaluatorDefinitions(checkType);
  const fieldGroups = getFieldOptionsByCategory();

  const handleFieldChange = (index: number, newField: string) => {
    const typedField = newField as CheckPreconditionFields;
    const currentRule = preconditions[index]?.rule as
      | CheckPreconditionRule
      | undefined;

    // If current rule is not allowed for the new field, reset to first allowed rule
    if (currentRule && !isRuleAllowedForField(typedField, currentRule)) {
      const allowedRules = getAllowedRulesForField(typedField);
      if (allowedRules.length > 0) {
        setValue(`preconditions.${index}.rule`, allowedRules[0]);
      }
    }

    // Reset value when switching to/from boolean field
    const newValueType = getFieldValueType(typedField);
    if (newValueType === "boolean") {
      setValue(`preconditions.${index}.value`, "true");
    }
  };

  return (
    <HorizontalFormControl label={label} helper={helper}>
      <VStack align="start" gap={4}>
        {evaluator?.requiredFields.includes("contexts") && (
          <Box borderLeft="4px solid" borderLeftColor="blue.400" width="full">
            <VStack
              borderLeftColor="reset"
              padding={3}
              width="full"
              align="start"
              position="relative"
            >
              <Text>Requires RAG Contexts</Text>
              <Text color="fg.muted" fontStyle="italic">
                This evaluator will only run if the RAG contexts are provided
              </Text>
            </VStack>
          </Box>
        )}
        {evaluator?.requiredFields.includes("expected_output") && (
          <Box borderLeft="4px solid" borderLeftColor="blue.400" width="full">
            <VStack
              borderLeftColor="reset"
              padding={3}
              width="full"
              align="start"
              position="relative"
            >
              <Text>Requires an Expected Output</Text>
              <Text color="fg.muted" fontStyle="italic">
                This evaluator will only run if the expected output is provided
              </Text>
            </VStack>
          </Box>
        )}
        {evaluator?.requiredFields.includes("expected_contexts") && (
          <Box borderLeft="4px solid" borderLeftColor="blue.400" width="full">
            <VStack
              borderLeftColor="reset"
              padding={3}
              width="full"
              align="start"
              position="relative"
            >
              <Text>Requires Expected Contexts</Text>
              <Text color="fg.muted" fontStyle="italic">
                This evaluator will only run if the expected contexts are
                provided
              </Text>
            </VStack>
          </Box>
        )}
        {fields.map((field, index) => {
          const currentField = preconditions[index]
            ?.field as CheckPreconditionFields;
          const allowedRules = getAllowedRulesForField(currentField);
          const valueType = getFieldValueType(currentField);

          return (
            <Box
              key={field.id}
              borderLeft="4px solid"
              borderLeftColor="blue.400"
              width="full"
            >
              <VStack
                borderLeftColor="reset"
                padding={3}
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
                  color="fg.subtle"
                >
                  <X />
                </Button>
                <SmallLabel>{index == 0 ? "When" : "and"}</SmallLabel>
                <HStack gap={2} flexWrap="wrap">
                  <NativeSelect.Root minWidth="fit-content">
                    <NativeSelect.Field
                      {...control.register(`preconditions.${index}.field`, {
                        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                          handleFieldChange(index, e.target.value);
                        },
                      })}
                    >
                      {fieldGroups.map((group) => (
                        <optgroup key={group.category} label={group.category}>
                          {group.fields.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>

                  <NativeSelect.Root minWidth="fit-content">
                    <NativeSelect.Field
                      {...control.register(`preconditions.${index}.rule`)}
                    >
                      {allowedRules.map((rule) => (
                        <option key={rule} value={rule}>
                          {RULE_LABELS[rule]}
                        </option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </HStack>
                <HStack width="full">
                  {valueType === "boolean" ? (
                    <NativeSelect.Root minWidth="fit-content">
                      <NativeSelect.Field
                        {...control.register(`preconditions.${index}.value`)}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </NativeSelect.Field>
                      <NativeSelect.Indicator />
                    </NativeSelect.Root>
                  ) : (
                    <>
                      {preconditions[index]?.rule.includes("regex") && (
                        <Text fontSize="16px">{"/"}</Text>
                      )}
                      <Input
                        {...control.register(`preconditions.${index}.value`)}
                        placeholder={
                          preconditions[index]?.rule.includes("regex")
                            ? "regex"
                            : "text"
                        }
                      />
                      {preconditions[index]?.rule.includes("regex") && (
                        <Text fontSize="16px">{"/gi"}</Text>
                      )}
                    </>
                  )}
                </HStack>
              </VStack>
              {(formState.errors.preconditions as any)?.[index]?.value && (
                <Text color="red.500" fontSize="12px" paddingLeft={4}>
                  {
                    (formState.errors.preconditions as any)?.[index]?.value
                      .message
                  }
                </Text>
              )}
            </Box>
          );
        })}
        {runOn}
        <Button
          onClick={() =>
            append({
              field: "output",
              rule: "contains",
              value: "",
              threshold: 0.85,
            })
          }
        >
          Add Precondition
        </Button>
      </VStack>
    </HorizontalFormControl>
  );
};
