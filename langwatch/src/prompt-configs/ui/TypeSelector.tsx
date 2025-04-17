import { Box, HStack, NativeSelect } from "@chakra-ui/react";
import { ChevronDown } from "react-feather";
import { TypeLabel } from "~/optimization_studio/components/nodes/Nodes";

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
              <option value="str">str</option>
              {isInput && <option value="image">image</option>}
              <option value="float">float</option>
              <option value="int">int</option>
              <option value="bool">bool</option>
              <option value="llm">llm</option>
              <option value="prompting_technique">prompting_technique</option>
              <option value="dataset">dataset</option>
              <option value="code">code</option>
              <option value="list[str]">list[str]</option>
            </NativeSelect.Field>
          </NativeSelect.Root>
        </>
      )}
    </HStack>
  );
}
