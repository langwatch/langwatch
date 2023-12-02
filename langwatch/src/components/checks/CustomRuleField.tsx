import React, { type PropsWithChildren } from "react";
import {
  Button,
  HStack,
  Select,
  Input,
  VStack,
  Text,
  Box,
  Textarea,
  Tooltip,
} from "@chakra-ui/react";
import { useFieldArray, useFormContext, Controller } from "react-hook-form";
import type {
  CustomCheckFailWhen,
  CustomCheckFields,
  CustomCheckRule,
} from "../../trace_checks/types";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { HelpCircle, X } from "react-feather";

const ruleOptions: Record<CustomCheckRule["rule"], string> = {
  contains: "contains",
  not_contains: "does not contain",
  is_similar_to: "is similar to",
  llm_boolean: "LLM boolean check",
  llm_score: "LLM score",
};

const conditionOptions: Record<CustomCheckFailWhen["condition"], string> = {
  "<": "smaller than",
  ">": "greater than",
  "<=": "smaller or equals to",
  ">=": "greater or equals to",
  "==": "equals to",
};

const fieldOptions: Record<CustomCheckFields, string> = {
  output: "output",
  input: "input",
};

export const CustomRuleField = () => {
  const { control, watch } = useFormContext();
  const rules = watch("parameters.rules");
  const { fields, append, remove } = useFieldArray({
    control,
    name: "parameters.rules",
  });

  const SmallLabel = ({ children }: PropsWithChildren) => (
    <Text fontSize={11} fontWeight="bold" textTransform="uppercase">
      {children}
    </Text>
  );

  return (
    <HorizontalFormControl
      label="Rules"
      helper="Define rules for this check to succeed"
    >
      <VStack align="start" spacing={4}>
        {fields.map((field, index) => (
          <Box
            key={field.id}
            borderLeft="4px solid"
            borderLeftColor="orange.400"
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
              <SmallLabel>Check that</SmallLabel>
              <HStack>
                <Controller
                  control={control}
                  name={`parameters.rules.${index}.field`}
                  render={({ field }) => (
                    <Select {...field} minWidth="fit-content">
                      {Object.entries(fieldOptions).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                />
                <Controller
                  control={control}
                  name={`parameters.rules.${index}.rule`}
                  render={({ field }) => (
                    <Select {...field} minWidth="fit-content">
                      {Object.entries(ruleOptions).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                />
              </HStack>
              <Controller
                control={control}
                name={`parameters.rules.${index}.value`}
                render={({ field }) =>
                  rules[index].rule == "llm_boolean" ? (
                    <Textarea
                      placeholder="intructions for the LLM, to be answered with true or false (e.g. please check if this response is telling the user to contact customer support or not)"
                      {...field}
                    />
                  ) : rules[index].rule == "llm_score" ? (
                    <Textarea
                      placeholder="intructions for the LLM to score the output (e.g. please score from 0.0 to 1.0 how polite this answer is)"
                      {...field}
                    />
                  ) : (
                    <Input placeholder="text" {...field} />
                  )
                }
              />
              {rules[index]?.rule &&
                ["llm_boolean", "llm_score"].includes(rules[index].rule) && (
                  <>
                    <SmallLabel>Model</SmallLabel>
                    <Controller
                      control={control}
                      name={`parameters.rules.${index}.model`}
                      render={({ field }) => (
                        <Select {...field} minWidth="fit-content">
                          {["gpt-4-1106-preview", "gpt-3.5-turbo"].map(
                            (value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            )
                          )}
                        </Select>
                      )}
                    />
                  </>
                )}
              {rules[index]?.rule &&
                ["is_similar_to", "llm_score"].includes(rules[index].rule) && (
                  <>
                    <HStack>
                      <SmallLabel>Fail when score is</SmallLabel>
                      {rules[index].rule == "is_similar_to" && (
                        <Tooltip
                          label={`this is how similar the ${rules[index].field} must be to the provided text for the check to pass, scored from 0.0 to 1.0. Similarity between the two texts is calculated by the cosine similarity of their semantic vectors`}
                        >
                          <HelpCircle width="14px" />
                        </Tooltip>
                      )}
                    </HStack>
                    <HStack>
                      <Controller
                        control={control}
                        name={`parameters.rules.${index}.failWhen.condition`}
                        render={({ field }) => (
                          <Select {...field} minWidth="fit-content">
                            {Object.entries(conditionOptions).map(
                              ([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              )
                            )}
                          </Select>
                        )}
                      />
                      <Controller
                        control={control}
                        name={`parameters.rules.${index}.failWhen.amount`}
                        render={({ field }) => (
                          <Input
                            width="110px"
                            type="number"
                            min="0"
                            max="1"
                            step="0.1"
                            placeholder="0.0"
                            {...field}
                            onChange={(e) => field.onChange(+e.target.value)}
                          />
                        )}
                      />
                    </HStack>
                  </>
                )}
            </VStack>
          </Box>
        ))}
        <Button
          onClick={() =>
            append({
              field: "output",
              rule: "contains",
              value: "",
              threshold: 0.85,
              failWhen: { condition: "<", amount: 0.5 },
            })
          }
        >
          Add Rule
        </Button>
      </VStack>
    </HorizontalFormControl>
  );
};
