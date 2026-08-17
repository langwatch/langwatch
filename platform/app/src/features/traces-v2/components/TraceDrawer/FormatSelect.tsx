import { Flex, HStack, Icon } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import { LuChevronDown } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { SegmentSubmodeIcon } from "./SegmentSubmodeIcon";

/**
 * A secondary axis of the active format, rendered as icon toggles inside
 * the selector pill (e.g. rendered/source markdown, thread/bubbles chat).
 */
export interface FormatSubmode {
  value: string;
  label: string;
  icon: IconType;
  /** Override default tooltip `${label} view`. */
  tooltip?: string;
}

export interface FormatSubmodeGroup {
  value: string;
  onChange: (value: string) => void;
  options: readonly FormatSubmode[];
}

/**
 * One option in a `<FormatSelect>`. The string-shorthand form covers the
 * simple case (label derived from the value); the object form opts into
 * `submodes` for an inline icon pair shown while the option is active.
 */
export interface FormatOption {
  value: string;
  label?: string;
  submodes?: FormatSubmodeGroup;
}

type Option = string | FormatOption;

interface FormatSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  /** Accessible name for the trigger, naming which panel's format it picks. */
  ariaLabel?: string;
}

function normalizeOption(option: Option): FormatOption {
  return typeof option === "string" ? { value: option } : option;
}

/** Initialisms keep their casing; everything else reads as a word. */
const VALUE_LABELS: Record<string, string> = { json: "JSON" };

function optionLabel(option: FormatOption): string {
  if (option.label) return option.label;
  const mapped = VALUE_LABELS[option.value];
  if (mapped) return mapped;
  return option.value.charAt(0).toUpperCase() + option.value.slice(1);
}

/**
 * Compact single-control picker for view formats (Pretty / Text / JSON /
 * Markdown, flat / JSON, thread / bubbles / markdown): the active format
 * reads in the pill with a caret, and the alternatives live in the menu it
 * opens. Replaces a row of segments so the toolbar keeps one footprint no
 * matter how many formats a panel offers. When the active option carries
 * `submodes`, their icon toggles render inside the pill, after the caret.
 */
export function FormatSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: FormatSelectProps) {
  const normalized = options.map(normalizeOption);
  const active =
    normalized.find((option) => option.value === value) ?? normalized[0];
  if (!active) return null;

  return (
    <HStack gap={0} flexShrink={0} height="26px" padding={0.5}>
      <Flex
        height="full"
        align="center"
        gap={0}
        borderRadius="sm"
        bg="blue.subtle"
        color="blue.fg"
        overflow="hidden"
      >
        <Menu.Root positioning={{ placement: "bottom-start" }}>
          <Menu.Trigger asChild>
            <Flex
              as="button"
              align="center"
              gap={1}
              paddingLeft={2.5}
              paddingRight={active.submodes ? 1.5 : 2}
              height="full"
              textStyle="2xs"
              textTransform="uppercase"
              letterSpacing="0.04em"
              fontWeight="semibold"
              cursor="pointer"
              aria-label={ariaLabel ?? "View format"}
              transition="background 0.12s ease"
              _hover={{ bg: "blue.solid/8" }}
            >
              {optionLabel(active)}
              <Icon as={LuChevronDown} boxSize={3} color="blue.fg/70" />
            </Flex>
          </Menu.Trigger>
          <Menu.Content minWidth="140px">
            {normalized.map((option) => (
              <Menu.Item
                key={option.value}
                value={option.value}
                onClick={() => onChange(option.value)}
                fontWeight={option.value === value ? "semibold" : undefined}
              >
                {optionLabel(option)}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
        {active.submodes?.options.map((sub) => (
          <SegmentSubmodeIcon
            key={sub.value}
            icon={sub.icon}
            label={sub.label}
            tooltip={sub.tooltip}
            active={active.submodes!.value === sub.value}
            onClick={() => active.submodes!.onChange(sub.value)}
          />
        ))}
      </Flex>
    </HStack>
  );
}
