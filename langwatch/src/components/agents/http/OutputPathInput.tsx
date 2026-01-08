import { Field, Input, Text, VStack } from "@chakra-ui/react";

export type OutputPathInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

/**
 * Input for JSONPath expression to extract output from API response.
 * Example: $.choices[0].message.content
 */
export function OutputPathInput({
  value,
  onChange,
  disabled = false,
}: OutputPathInputProps) {
  return (
    <VStack align="stretch" gap={1} width="full">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="$.choices[0].message.content"
        fontFamily="mono"
        fontSize="13px"
        disabled={disabled}
      />
      <Text fontSize="xs" color="gray.500">
        Path to extract the agent response from the API response
      </Text>
    </VStack>
  );
}
