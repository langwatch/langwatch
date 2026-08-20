import { Flex, HStack } from "@chakra-ui/react";

/**
 * One option in a `<SegmentedToggle>`. The string-shorthand form covers
 * the simple case (label === value).
 */
export interface SegmentedOption {
  value: string;
  label?: string;
}

type Option = string | SegmentedOption;

interface SegmentedToggleProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
}

function normalizeOption(option: Option): SegmentedOption {
  return typeof option === "string" ? { value: option } : option;
}

/**
 * Side-by-side pill tabs for switching between a small number of peers
 * (trace/spans, edited/original). View *formats* are picked through
 * `<FormatSelect>` instead, which compresses them into one control.
 */
export function SegmentedToggle({
  value,
  onChange,
  options,
}: SegmentedToggleProps) {
  return (
    <HStack gap={0.5} flexShrink={0} height="26px" padding={0.5}>
      {options.map((rawOption) => {
        const option = normalizeOption(rawOption);
        const isActive = value === option.value;
        return (
          <Flex
            key={option.value}
            as="button"
            onClick={() => onChange(option.value)}
            textStyle="2xs"
            textTransform="uppercase"
            letterSpacing="0.04em"
            fontWeight="semibold"
            color={isActive ? "blue.fg" : "fg.subtle"}
            bg={isActive ? "blue.subtle" : "transparent"}
            paddingX={2.5}
            overflow="hidden"
            height="full"
            align="center"
            cursor="pointer"
            borderRadius="sm"
            transition="background 0.12s ease, color 0.12s ease"
            _hover={isActive ? undefined : { color: "fg" }}
          >
            {option.label ?? option.value}
          </Flex>
        );
      })}
    </HStack>
  );
}
