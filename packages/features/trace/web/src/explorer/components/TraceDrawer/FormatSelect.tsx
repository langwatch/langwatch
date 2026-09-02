import { Flex, HStack, Icon } from "@chakra-ui/react";
import { forwardRef } from "react";
import type { IconType } from "react-icons";
import { LuChevronDown } from "react-icons/lu";
import { Menu } from "@langwatch/design-system/menu";
import { SegmentSubmodeIcon } from "./SegmentSubmodeIcon";

/**
 * A secondary axis of the active format, rendered as icon toggles inside
 * the selector pill (e.g. rendered/source markdown, thread/bubbles chat).
 */
export interface FormatSubmode<Submode extends string = string> {
  value: Submode;
  label: string;
  icon: IconType;
  /** Override default tooltip `${label} view`. */
  tooltip?: string;
}

export interface FormatSubmodeGroup<Submode extends string = string> {
  value: Submode;
  /**
   * Method syntax on purpose: it makes the parameter bivariant, so a handler
   * that accepts only its own submode union still fits a group typed with the
   * wider `string`. Every value it can receive comes from `options` below,
   * which the same caller declares.
   */
  onChange(value: Submode): void;
  options: readonly FormatSubmode<Submode>[];
}

/**
 * One option in a `<FormatSelect>`. The string-shorthand form covers the
 * simple case (label derived from the value); the object form opts into
 * `submodes` for an inline icon pair shown while the option is active.
 */
export interface FormatOption<Value extends string = string> {
  value: Value;
  label?: string;
  // Submodes are a second axis, unrelated to the format union, so they carry
  // their own value type.
  submodes?: FormatSubmodeGroup<string>;
}

type Option<Value extends string> = Value | FormatOption<Value>;

interface FormatSelectProps<Value extends string> {
  value: Value;
  onChange: (value: Value) => void;
  options: readonly Option<Value>[];
  /** Accessible name for the trigger, naming which panel's format it picks. */
  ariaLabel?: string;
}

/** Accepts the string shorthand, which is an option with nothing but a value. */
function normalizeOption<Value extends string>(
  option: Option<Value>,
): FormatOption<Value> {
  return typeof option === "string" ? { value: option } : option;
}

/** Initialisms keep their casing; everything else reads as a word. */
const VALUE_LABELS: Record<string, string> = { json: "JSON" };

/** The words an option reads as, on the pill and in the menu. */
function optionLabel(option: FormatOption<string>): string {
  if (option.label) return option.label;
  const mapped = VALUE_LABELS[option.value];
  if (mapped) return mapped;
  return option.value.charAt(0).toUpperCase() + option.value.slice(1);
}

/**
 * The pill: the active format in words, and the caret that opens the menu.
 *
 * Rendered under `Menu.Trigger asChild`, which clones this and hands it the
 * menu's own props and ref, so both are forwarded through.
 */
const FormatSelectTrigger = forwardRef<
  // `Flex` types its ref as a div even with `as="button"`.
  HTMLDivElement,
  {
    label: string;
    ariaLabel: string;
    /** Submodes follow inside the pill, so the trailing padding closes up. */
    tightEnd: boolean;
  } & React.ComponentProps<typeof Flex>
>(function FormatSelectTrigger({ label, ariaLabel, tightEnd, ...triggerProps }, ref) {
  return (
    <Flex
      ref={ref}
      as="button"
      align="center"
      gap={1}
      paddingLeft={2.5}
      paddingRight={tightEnd ? 1.5 : 2}
      height="full"
      textStyle="2xs"
      textTransform="uppercase"
      letterSpacing="0.04em"
      fontWeight="semibold"
      cursor="pointer"
      aria-label={ariaLabel}
      transition="background 0.12s ease"
      _hover={{ bg: "blue.solid/8" }}
      {...triggerProps}
    >
      {label}
      <Icon as={LuChevronDown} boxSize={3} color="blue.fg/70" />
    </Flex>
  );
});

/** The active format's second axis, as icon toggles inside the pill. */
function FormatSubmodeStrip({ submodes }: { submodes: FormatSubmodeGroup }) {
  return (
    <>
      {submodes.options.map((sub) => (
        <SegmentSubmodeIcon
          key={sub.value}
          icon={sub.icon}
          label={sub.label}
          tooltip={sub.tooltip}
          active={submodes.value === sub.value}
          onClick={() => submodes.onChange(sub.value)}
        />
      ))}
    </>
  );
}

/**
 * Compact single-control picker for view formats (Pretty / Text / JSON /
 * Markdown, flat / JSON, thread / bubbles / markdown): the active format
 * reads in the pill with a caret, and the alternatives live in the menu it
 * opens. Replaces a row of segments so the toolbar keeps one footprint no
 * matter how many formats a panel offers. When the active option carries
 * `submodes`, their icon toggles render inside the pill, after the caret.
 */
export function FormatSelect<Value extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: FormatSelectProps<Value>) {
  const normalized = options.map(normalizeOption);
  const active = normalized.find((option) => option.value === value) ?? normalized[0];
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
            <FormatSelectTrigger
              label={optionLabel(active)}
              ariaLabel={ariaLabel ?? "View format"}
              tightEnd={!!active.submodes}
            />
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
        {active.submodes && <FormatSubmodeStrip submodes={active.submodes} />}
      </Flex>
    </HStack>
  );
}
