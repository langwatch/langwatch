import React from 'react';
import { Button, HStack, Select, Input, VStack } from '@chakra-ui/react';
import { useFieldArray, useFormContext, Controller } from 'react-hook-form';

const ruleOptions = [
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'is_similar_to', label: 'Is similar to' },
  { value: 'similarity_score', label: 'Similarity score' },
  { value: 'llm_boolean', label: 'LLM Boolean' },
  { value: 'llm_score', label: 'LLM Score' },
];

const conditionOptions = [
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: '==', label: '==' },
];

const fieldOptions = [
  { value: 'input', label: 'Input' },
  { value: 'output', label: 'Output' },
];

export const CustomRuleField = () => {
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'customRules',
  });

  return (
    <VStack align="start">
      {fields.map((field, index) => (
        <HStack key={field.id}>
          <Controller
            control={control}
            name={`customRules.${index}.field`}
            render={({ field }) => (
              <Select {...field}>
                {fieldOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          />
          <Controller
            control={control}
            name={`customRules.${index}.rule`}
            render={({ field }) => (
              <Select {...field}>
                {ruleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          />
          <Controller
            control={control}
            name={`customRules.${index}.value`}
            render={({ field }) => <Input {...field} />}
          />
          <Button onClick={() => remove(index)}>Remove</Button>
        </HStack>
      ))}
      <Button onClick={() => append({ field: '', rule: '', value: '' })}>
        Add Rule
      </Button>
    </VStack>
  );
};