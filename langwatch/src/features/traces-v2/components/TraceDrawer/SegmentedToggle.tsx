import { Flex, HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * One option in a `<SegmentedToggle>`. The string-shorthand form covers
 * the simple case (label === value); the object form lets a segment
 * embed extra controls *inside* its own pill via `trailing` — used by
 * the I/O viewer to inline the rendered/source icon pair into the
 * `[markdown]` segment when it's active, like an X-clear button inside
 * a search-bar token.
 */
export interface SegmentedOption {
  value: string;
  label?: string;
  /**
   * Rendered inside the segment's pill, after the label, when the
   * segment is the active one. Click handlers on this content should
   * stop propagation so they don't bubble into the segment's onClick.
   */
  trailing?: ReactNode;
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

export function SegmentedToggle({
  value,
  onChange,
  options,
}: SegmentedToggleProps) {
  return (
    <HStack
      gap={0.5}
      flexShrink={0}
      height="26px"
      padding={0.5}
    >
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
            paddingRight={isActive && option.trailing ? 0 : 2.5}
            overflow="hidden"
            height="full"
            align="center"
            // Tight gap when trailing icons are embedded so the dividers
            // read as attached to label + icons rather than floating.
            gap={option.trailing ? .5 : 0}
            cursor="pointer"
            borderRadius="sm"
            transition="background 0.12s ease, color 0.12s ease"
            _hover={isActive ? undefined : { color: "fg" }}
          >
            {option.label ?? option.value}
            {isActive && option.trailing}
          </Flex>
        );
      })}
    </HStack>
  );
}
