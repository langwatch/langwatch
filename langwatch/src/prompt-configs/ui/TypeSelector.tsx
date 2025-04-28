import { Box, HStack, NativeSelect } from "@chakra-ui/react";
import { ChevronDown } from "react-feather";
import { TypeLabel } from "~/optimization_studio/components/nodes/Nodes";
import type { LlmConfigInputType, LlmConfigOutputType } from "~/types";

/**
 * Type selector with dropdown for field types
 * ie: str, image, float, int, bool, llm, prompting_technique, dataset, code, list[str]
 */
export function TypeSelector({
  name,
  value,
  onChange,
  isInput,
  readOnly,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  isInput?: boolean;
  readOnly?: boolean;
}) {
  return (
    <HStack
      position="relative"
      background="white"
      borderRadius="8px"
      paddingX={2}
      paddingY={1}
      gap={2}
      height="full"
    >
      <Box fontSize="13px">
        <TypeLabel type={value} />
      </Box>
      {!readOnly && (
        <>
          <Box color="gray.600">
            <ChevronDown size={14} />
          </Box>
          <NativeSelect.Root
            position="absolute"
            top={0}
            left={0}
            height="32px"
            width="100%"
            cursor="pointer"
            zIndex={10}
            opacity={0}
          >
            <NativeSelect.Field
              name={name}
              value={value}
              onChange={(e) => onChange(e.target.value)}
            >
              {isInput ? <InputOptions /> : <OutputOptions />}
            </NativeSelect.Field>
          </NativeSelect.Root>
        </>
      )}
    </HStack>
  );
}

function InputOptions() {
  return (
    <>
      <InputOption type="str" />
      <InputOption type="image" />
      <InputOption type="float" />
      <InputOption type="bool" />
    </>
  );
}

function OutputOptions() {
  return (
    <>
      <OutputOption type="str" />
      <OutputOption type="float" />
      <OutputOption type="bool" />
    </>
  );
}

function InputOption({ type }: { type: LlmConfigInputType }) {
  return <option value={type}>{type}</option>;
}

function OutputOption({ type }: { type: LlmConfigOutputType }) {
  return <option value={type}>{type}</option>;
}
