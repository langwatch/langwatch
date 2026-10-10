import { Input, Text, VStack } from "@langwatch/design-system/primitives";

import { HttpJsonPathText } from "./http-json-path-text.tsx";

export const OUTPUT_PATH_INPUT_ID = "http-output-path-input";

export type HttpOutputPathInputProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** The response the path is checked against: the last test response, else a known schema. */
  shape?: unknown;
  /** True when `shape` is a schema sample, so any array index counts. */
  shapeIsSample?: boolean;
};

/**
 * Input for JSONPath expression to extract output from API response.
 * Example: $.choices[0].message.content
 */
export function OutputPathInput({
  value,
  onChange,
  disabled = false,
  shape,
  shapeIsSample = false,
}: HttpOutputPathInputProps) {
  return (
    <VStack align="stretch" gap={1} width="full">
      <Input
        id={OUTPUT_PATH_INPUT_ID}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="$.choices[0].message.content"
        fontFamily="mono"
        fontSize="13px"
        disabled={disabled}
      />
      {value && <HttpJsonPathText path={value} shape={shape} anyIndex={shapeIsSample} />}
      <Text fontSize="xs" color="fg.muted">
        Path to extract the agent response from the API response.
      </Text>
      <Text fontSize="xs" color="yellow.fg">
        Note: HTTP Agents must return text.
      </Text>
    </VStack>
  );
}
