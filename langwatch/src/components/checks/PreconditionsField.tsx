import {
  Box,
  Button,
  HStack,
  Input,
  Select,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import type {
  CheckPrecondition,
  CustomCheckFields,
} from "../../trace_checks/types";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { HelpCircle, X } from "react-feather";
import { SmallLabel } from "../SmallLabel";

const ruleOptions: Record<CheckPrecondition["rule"], string> = {
  not_contains: "does not contain",
  contains: "contains",
  is_similar_to: "is similar to",
  matches_regex: "matches regex",
};

const fieldOptions: Record<CustomCheckFields, string> = {
  output: "output",
  input: "input",
};

export const PreconditionsField = ({
  runOn,
}: {
  runOn: JSX.Element | null;
}) => {
  const { control, watch } = useFormContext();
  const preconditions = watch("preconditions");
  const { fields, append, remove } = useFieldArray({
    control,
    name: "preconditions",
  });

  return (
    <HorizontalFormControl
      label="Preconditions"
      helper="Conditions that must be met for this check to run"
    >
      <VStack align="start" spacing={4}>
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
              <HStack spacing={4}>
                <Select
                  {...control.register(`preconditions.${index}.field`)}
                  minWidth="fit-content"
                >
                  {Object.entries(fieldOptions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  {...control.register(`preconditions.${index}.rule`)}
                  minWidth="fit-content"
                >
                  {Object.entries(ruleOptions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </HStack>
              <HStack width="full">
                {preconditions[index]?.rule.includes("regex") && (
                  <Text fontSize={16}>{"/"}</Text>
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
                  <Text fontSize={16}>{"/g"}</Text>
                )}
              </HStack>
              {preconditions[index]?.rule === "is_similar_to" && (
                <>
                  <HStack>
                    <SmallLabel>With semantic similarity above </SmallLabel>
                    <Tooltip
                      label={`this is how similar the ${preconditions[index].field} must be to the provided text for the check to be evaluated, scored from 0.0 to 1.0. Similarity between the two texts is calculated by the cosine similarity of their semantic vectors`}
                    >
                      <HelpCircle width="14px" />
                    </Tooltip>
                  </HStack>
                  <Controller
                    control={control}
                    name={`parameters.rules.${index}.threshold`}
                    render={({ field }) => (
                      <Input
                        width="110px"
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        placeholder="0.0"
                        {...field}
                        value={field.value ?? 0.85}
                        onChange={(e) => field.onChange(+e.target.value)}
                      />
                    )}
                  />
                </>
              )}
            </VStack>
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
