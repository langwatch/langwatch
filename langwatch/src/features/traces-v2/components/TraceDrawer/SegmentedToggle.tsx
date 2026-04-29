import { Flex, HStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { SegmentSubmodeIcon } from "./SegmentSubmodeIcon";

/**
 * A sub-mode toggle rendered *inside* the parent segment's pill when
 * that segment is active. Used to expose a secondary axis (e.g.
 * rendered/source markdown, thread/bubbles chat) without growing a
 * second standalone toggle row beside it.
 */
export interface SegmentSubmode {
  value: string;
  label: string;
  icon: IconType;
  /** Override default tooltip `${label} view`. */
  tooltip?: string;
}

export interface SegmentSubmodeGroup {
  value: string;
  onChange: (value: string) => void;
  options: readonly SegmentSubmode[];
}

/**
 * One option in a `<SegmentedToggle>`. The string-shorthand form covers
 * the simple case (label === value); the object form opts into either
 * `submodes` (declarative inline icon pair, the common case) or
 * `trailing` (escape hatch for arbitrary JSX inside the active pill).
 */
export interface SegmentedOption {
  value: string;
  label?: string;
  submodes?: SegmentSubmodeGroup;
  /** Escape hatch — prefer `submodes`. */
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
    <HStack gap={0.5} flexShrink={0} height="26px" padding={0.5}>
      {options.map((rawOption) => {
        const option = normalizeOption(rawOption);
        const isActive = value === option.value;
        const hasInline = option.submodes != null || option.trailing != null;
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
            paddingLeft={2.5}
            paddingRight={isActive && hasInline ? 0 : 2.5}
            overflow="hidden"
            height="full"
            align="center"
            // Submode icons live flush together; the gap between the
            // label and the first icon is recreated as a marginRight on
            // the label below so it visually mirrors the badge's
            // leading padding.
            gap={0}
            cursor="pointer"
            borderRadius="sm"
            transition="background 0.12s ease, color 0.12s ease"
            _hover={isActive ? undefined : { color: "fg" }}
          >
            <Flex
              as="span"
              align="center"
              marginRight={isActive && hasInline ? 2.5 : 0}
            >
              {option.label ?? option.value}
            </Flex>
            {isActive && option.submodes && (
              <>
                {option.submodes.options.map((sub) => (
                  <SegmentSubmodeIcon
                    key={sub.value}
                    icon={sub.icon}
                    label={sub.label}
                    tooltip={sub.tooltip}
                    active={option.submodes!.value === sub.value}
                    onClick={() => option.submodes!.onChange(sub.value)}
                  />
                ))}
              </>
            )}
            {isActive && option.trailing}
          </Flex>
        );
      })}
    </HStack>
  );
}
