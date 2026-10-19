/**
 * One card of settings, the same shape on every settings page: a status dot, a
 * name and a chip in the header, the facts as name-left/value-right rows, and
 * the actions under them. Presentational only: no fetching, no module words.
 */
import { Badge, Box, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { Card, type CardStatus } from "./card.tsx";

export { StatusDot } from "./card.tsx";

export type SettingsTone = CardStatus;

/** A chip's tone, in the words the cards speak. */
export type StatusChipTone = "neutral" | "good" | "warning" | "bad";

/**
 * @deprecated Use `Card` from `@langwatch/design-system/card`: `leading` is `icon`, `hint` is
 * `description`, `tone` is `status`, `actions` is `footer`. Goes in W-final.
 */
export function SettingsCard({
  title,
  hint,
  tone,
  leading,
  badge,
  actions,
  children,
  "data-testid": testId,
}: {
  title: ReactNode;
  /** A mark before the name: the protocol's or the vendor's. */
  leading?: ReactNode;
  /** What this card is about, in one line under the title. */
  hint?: ReactNode;
  /** Where this card's subject stands. Omitted where it has no state. */
  tone?: SettingsTone;
  /** The state in words, always beside the dot, never instead of it. */
  badge?: ReactNode;
  /** What the reader can do about it, directly under the settings. */
  actions?: ReactNode;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Card
      title={title}
      icon={leading}
      description={hint}
      status={tone}
      badge={badge}
      footer={actions}
      data-testid={testId}
    >
      {children != null && (
        <VStack align="stretch" gap={2}>
          {children}
        </VStack>
      )}
    </Card>
  );
}

/** One setting: its name on the left (a hint under it), its state on the right. */
export function SettingRow({
  label,
  hint,
  children,
  "data-testid": testId,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns="1fr 1fr"
      alignItems="center"
      gap={6}
      width="full"
      paddingY={2.5}
      data-testid={testId}
    >
      <Box minWidth={0}>
        <Text textStyle="label">{label}</Text>
        {hint && (
          <Text textStyle="caption" color="fg.muted" marginTop={0.5}>
            {hint}
          </Text>
        )}
      </Box>
      {children && (
        <HStack gap={2} minWidth={0} align="center">
          {children}
        </HStack>
      )}
    </Box>
  );
}

/** A group of rows, hairline-separated so the group reads as one object. */
export function SettingList({
  children,
  "data-testid": testId,
}: {
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      separator={<Box height="1px" background="border.nested" />}
      data-testid={testId}
    >
      {children}
    </VStack>
  );
}

/** A record inside a SettingList; interactive rows share the same spacing and focus ring. */
export const SettingItem = chakra("div", {
  base: {
    width: "full",
    minWidth: 0,
    minHeight: "16",
    paddingY: "3",
    paddingX: "2",
    textAlign: "start",
    color: "fg",
    background: "transparent",
    borderRadius: "sm",
    "&:is(button, a)": {
      cursor: "pointer",
      _hover: { background: "bg.hover" },
      _focusVisible: {
        outline: "2px solid",
        outlineColor: "blue.fg",
        outlineOffset: "-2px",
      },
    },
  },
});

const CHIP_PALETTE: Record<StatusChipTone, string> = {
  good: "green",
  warning: "orange",
  bad: "red",
  neutral: "gray",
};

/** A short state in words, washed in its tone. */
export function StatusChip({
  label,
  tone = "neutral",
  title,
  shimmer = false,
  "data-testid": testId,
}: {
  label: string;
  tone?: StatusChipTone;
  /** The longer explanation, on hover. */
  title?: string;
  /** A state waiting on the reader rather than on a system. */
  shimmer?: boolean;
  "data-testid"?: string;
}) {
  const palette = CHIP_PALETTE[tone];

  return (
    <Badge
      size="sm"
      variant="subtle"
      colorPalette={palette}
      title={title}
      className={shimmer ? "lw-chip-shimmer" : undefined}
      data-testid={testId}
    >
      {label}
    </Badge>
  );
}

/** The chip an overview card wears: where this subject stands, never a raw state name. */
export type OverviewChip = {
  label: string;
  tone: StatusChipTone;
  title: string;
  shimmer?: boolean;
};

/** A settings card whose chip and dot say the same thing, over a list of facts. */
export function OverviewCard({
  title,
  hint,
  leading,
  chip,
  children,
  actions,
  "data-testid": testId,
}: {
  title: string;
  hint?: ReactNode;
  leading?: ReactNode;
  chip?: OverviewChip;
  children: ReactNode;
  actions?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <SettingsCard
      title={title}
      hint={hint}
      leading={leading}
      tone={chip ? settingsToneFor(chip.tone) : void 0}
      badge={
        chip && (
          <StatusChip
            label={chip.label}
            tone={chip.tone}
            title={chip.title}
            shimmer={chip.shimmer}
          />
        )
      }
      actions={actions}
      data-testid={testId}
    >
      <SettingList>{children}</SettingList>
    </SettingsCard>
  );
}

/** One labelled fact inside an overview card, at the row's own size. */
export function OverviewDetail({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingRow label={label} hint={hint}>
      <Box textStyle="bodySm">{children}</Box>
    </SettingRow>
  );
}

/** The one translation between the chip's tones and the dot's. */
export function settingsToneFor(tone: StatusChipTone): SettingsTone {
  if (tone === "good") return "ok";
  if (tone === "warning") return "warning";
  if (tone === "bad") return "bad";
  return "neutral";
}
