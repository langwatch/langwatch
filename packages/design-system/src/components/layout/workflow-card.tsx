import type { ComponentProps, MouseEventHandler, ReactNode } from "react";

import { Box, type BoxProps, chakra, HStack, Spacer, Text, VStack } from "../../primitives.ts";

const ICON_SIZE = { xs: "16px", md: "24px", lg: "28px" } as const;
const ICON_FONT_SIZE = { xs: "12px", md: "16px", lg: "18px" } as const;

/** A workflow's emoji or glyph on a dotted tile. */
export function WorkflowIcon({
  icon,
  size,
  ...props
}: { icon: ReactNode; size: keyof typeof ICON_SIZE } & BoxProps) {
  return (
    <Box
      backgroundColor="bg.subtle"
      backgroundImage="radial-gradient(circle at 4px 4px, var(--chakra-colors-border) 1px, transparent 1px)"
      backgroundSize="6px 6px"
      borderRadius="4px"
      border="1px solid"
      borderColor="border"
      width={ICON_SIZE[size]}
      minWidth={ICON_SIZE[size]}
      height={ICON_SIZE[size]}
      minHeight={ICON_SIZE[size]}
      display="flex"
      alignItems="center"
      justifyContent="center"
      color="fg"
      fontSize={ICON_FONT_SIZE[size]}
      {...props}
    >
      {icon}
    </Box>
  );
}

export type WorkflowCardBaseProps = Omit<ComponentProps<typeof VStack>, "onClick"> & {
  /** Opens the card, from a full-card button stacked beneath the card's own controls. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** What the opener is called; the card's name by default. */
  label?: string;
  /** Opens the card some other way (a link styled with `WORKFLOW_CARD_OPENER_STYLE`). */
  opener?: ReactNode;
};

/** The whole-card target: stretched over the card, beneath its controls, reachable by keyboard. */
export const WORKFLOW_CARD_OPENER_STYLE = {
  position: "absolute",
  inset: 0,
  zIndex: 1,
  borderRadius: "xl",
  cursor: "pointer",
  _focusVisible: { outline: "2px solid", outlineColor: "blue.focusRing" },
} as const;

export function WorkflowCardBase({
  onClick,
  label,
  opener,
  children,
  ...props
}: WorkflowCardBaseProps) {
  return (
    <VStack
      align="start"
      position="relative"
      padding={4}
      gap={2}
      borderRadius="xl"
      background="bg.panel"
      boxShadow="md"
      height="142px"
      transition="all 0.2s ease-in-out"
      border="1px solid"
      borderColor="border.muted"
      _hover={{ boxShadow: "xl", textDecoration: "none" }}
      {...props}
    >
      {opener ??
        (onClick && (
          <chakra.button
            type="button"
            aria-label={label}
            onClick={onClick}
            {...WORKFLOW_CARD_OPENER_STYLE}
          />
        ))}
      {children}
    </VStack>
  );
}

export type WorkflowCardDisplayProps = {
  name: string;
  icon: ReactNode;
  description?: string;
  /** Already formatted, e.g. "Updated 2 hours ago"; the card does not read the clock. */
  updatedAtLabel?: string;
  action?: ReactNode;
  children?: ReactNode;
} & WorkflowCardBaseProps;

/** A workflow as a card: icon, name or description, and when it last changed. */
export function WorkflowCardDisplay({
  name,
  icon,
  description,
  updatedAtLabel,
  action,
  children,
  ...props
}: WorkflowCardDisplayProps) {
  return (
    <WorkflowCardBase paddingX={0} label={name} {...props}>
      <HStack gap={4} paddingX={4} paddingBottom={2} width="full">
        <WorkflowIcon icon={icon} size="lg" />
        {description && (
          <Text color="fg" fontSize="sm" fontWeight={500}>
            {name}
          </Text>
        )}
        <Spacer />
        <Box position="relative" zIndex={2}>
          {action}
        </Box>
      </HStack>
      {children}
      {!description && <Spacer />}
      <Text paddingX={4} color="fg" fontSize="sm" fontWeight={!description ? 500 : undefined}>
        {description ?? name}
      </Text>
      <Text paddingX={4} color="fg.subtle" fontSize="12px">
        {updatedAtLabel}
      </Text>
    </WorkflowCardBase>
  );
}
