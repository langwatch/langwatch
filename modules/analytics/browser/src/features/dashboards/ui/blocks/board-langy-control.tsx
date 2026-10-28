/**
 * Whether a board's widgets count Langy's conversations, beside the period: a pill opening two
 * choices, "Left out" and "Included", with a tick on the current one. A reader who may not edit
 * the board sees the same value as a badge that says why on hover.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200, AC200d
 */

import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ChevronDown, Sparkles } from "lucide-react";

const LANGY_CHOICES = [
  {
    value: "left-out",
    label: "Left out",
    hint: "Widgets count your agent's traces only.",
  },
  {
    value: "included",
    label: "Included",
    hint: "Widgets also count your conversations with Langy.",
  },
] as const;

const LOCKED_TIP = "Only a member who can edit this dashboard changes this.";

type LangyChoice = (typeof LANGY_CHOICES)[number];

export function BoardLangyControl({
  includesLangy,
  isSaving = false,
  onPick,
}: {
  includesLangy: boolean;
  /** While a pick is saving the menu stays shut, so a second pick cannot overtake it. */
  isSaving?: boolean;
  /** Absent where the reader cannot edit the board. */
  onPick?: (includeLangy: boolean) => void;
}) {
  const current = includesLangy ? LANGY_CHOICES[1] : LANGY_CHOICES[0];
  if (!onPick) return <LangyBadge current={current} />;
  return <LangyMenu current={current} isSaving={isSaving} onPick={onPick} />;
}

function LangyBadge({ current }: { current: LangyChoice }) {
  return (
    <HStack
      as="span"
      flexShrink={0}
      gap={1.5}
      borderRadius="lg"
      paddingX={2.5}
      height="26px"
      background="bg.muted"
      color="fg.muted"
      textStyle="caption"
      cursor="help"
      title={LOCKED_TIP}
      data-langy={current.value}
    >
      <Sparkles size={12} aria-hidden />
      {`Langy traces: ${current.label}`}
    </HStack>
  );
}

function LangyMenu({
  current,
  isSaving,
  onPick,
}: {
  current: LangyChoice;
  isSaving: boolean;
  onPick: (includeLangy: boolean) => void;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild disabled={isSaving}>
        <LangyTrigger current={current} />
      </Menu.Trigger>
      <Menu.Content minWidth="260px">
        <Menu.RadioItemGroup
          aria-label="Langy traces"
          value={current.value}
          onValueChange={({ value }) => {
            if (value !== current.value) onPick(value === "included");
          }}
        >
          <Box paddingX={2} paddingTop={1} paddingBottom={1.5}>
            <Text textStyle="eyebrow" color="fg.subtle">
              Langy traces
            </Text>
            <Text textStyle="caption" color="fg.muted">
              Your conversations with Langy are traced into this project.
            </Text>
          </Box>
          {LANGY_CHOICES.map((choice) => (
            <Menu.RadioItem key={choice.value} value={choice.value} aria-label={choice.label}>
              <VStack align="start" gap={0}>
                <Text textStyle="label">{choice.label}</Text>
                <Text textStyle="caption" color="fg.muted">
                  {choice.hint}
                </Text>
              </VStack>
            </Menu.RadioItem>
          ))}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}

function LangyTrigger({ current, ...props }: { current: LangyChoice }) {
  return (
    <Button
      {...props}
      variant="outline"
      aria-label={`Langy traces: ${current.label}`}
      title="Whether widgets count your conversations with Langy"
      height="26px"
      minWidth={0}
      paddingX={2.5}
      paddingY={0}
      gap={1.5}
      borderRadius="lg"
      borderColor="border"
      background="bg.panel"
      textStyle="caption"
      fontWeight="normal"
      _hover={{ borderColor: "border.emphasized", background: "bg.panel" }}
      data-langy={current.value}
    >
      <Box as="span" color="fg.subtle">
        <Sparkles size={13} aria-hidden />
      </Box>
      <Text as="span" color="fg.muted">
        Langy traces:
      </Text>
      <Text as="span" fontWeight="medium" color="fg">
        {current.label}
      </Text>
      <Box as="span" color="gray.400">
        <ChevronDown size={12} aria-hidden />
      </Box>
    </Button>
  );
}
