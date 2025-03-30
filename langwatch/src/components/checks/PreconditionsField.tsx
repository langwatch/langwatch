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
  CheckPrecondition,
  CheckPreconditionFields,
} from "../../server/evaluations/types";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { SmallLabel } from "../SmallLabel";

const ruleOptions: Record<CheckPrecondition["rule"], string> = {
  not_contains: "does not contain",
  contains: "contains",
  matches_regex: "matches regex",
};

const fieldOptions: Record<CheckPreconditionFields, string> = {
  output: "output",
  input: "input",
  "metadata.labels": "metadata.labels",
};

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
  const { control, watch, formState } = useFormContext();
  const preconditions = watch("preconditions");
  const checkType = watch("checkType");

  const evaluator = getEvaluatorDefinitions(checkType);

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
              <Text color="gray.500" fontStyle="italic">
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
              <Text color="gray.500" fontStyle="italic">
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
              <Text color="gray.500" fontStyle="italic">
                This evaluator will only run if the expected contexts are
                provided
              </Text>
            </VStack>
          </Box>
        )}
        {fields.map((field, index) => (
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
                color="gray.400"
              >
                <X />
              </Button>
              <SmallLabel>{index == 0 ? "When" : "and"}</SmallLabel>
              <HStack gap={2} flexWrap="wrap">
                <NativeSelect.Root minWidth="fit-content">
                  <NativeSelect.Field
                    {...control.register(`preconditions.${index}.field`)}
                  >
                    {Object.entries(fieldOptions).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>

                <NativeSelect.Root minWidth="fit-content">
                  <NativeSelect.Field
                    {...control.register(`preconditions.${index}.rule`)}
                  >
                    {Object.entries(ruleOptions).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </HStack>
              <HStack width="full">
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
        ))}
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
