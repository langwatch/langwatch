import { Flex, HStack } from "@chakra-ui/react";

interface SegmentedToggleProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}

export function SegmentedToggle({
  value,
  onChange,
  options,
}: SegmentedToggleProps) {
  return (
    <HStack
      gap={0}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border"
      overflow="hidden"
      flexShrink={0}
      bg="bg.panel"
      height="26px"
    >
      {options.map((option, i) => {
        const isActive = value === option;
        return (
          <Flex
            key={option}
            as="button"
            onClick={() => onChange(option)}
            textStyle="2xs"
            textTransform="uppercase"
            letterSpacing="0.04em"
            fontWeight="semibold"
            color={isActive ? "fg" : "fg.subtle"}
            bg={isActive ? "bg.emphasized" : "bg.panel"}
            paddingX={2.5}
            height="full"
            align="center"
            cursor="pointer"
            transition="background 0.12s ease, color 0.12s ease"
            borderLeftWidth={i === 0 ? 0 : "1px"}
            borderColor="border"
            _hover={isActive ? undefined : { color: "fg", bg: "bg.muted" }}
          >
            {option}
          </Flex>
        );
      })}
    </HStack>
  );
}
