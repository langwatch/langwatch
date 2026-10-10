/**
 * One band of a settings page: a hairline above, icon, title, one line of what
 * it is for, an optional action, then the body. Presentational only.
 */
import { Box, EmptyState, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** The page's one vertical measure; a page header pads its bottom by it. */
export const SETTINGS_BAND_PADDING_Y = { base: 5, md: 6 };

export interface SettingsSectionProps {
  /** An 18px lucide icon. */
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  /** A state the band is in, beside the title. */
  badge?: ReactNode;
  /** The section's one action, aligned with the title. */
  actions?: ReactNode;
  /** What a link elsewhere on the page scrolls to. */
  anchorId?: string;
  /** False drops the rule and band padding, for a section inside a card page. */
  divided?: boolean;
  children?: ReactNode;
  "data-testid"?: string;
}

export function SettingsSection({
  icon,
  title,
  hint,
  badge,
  actions,
  anchorId,
  divided = true,
  children,
  "data-testid": testId,
}: SettingsSectionProps) {
  return (
    <Box
      as="section"
      id={anchorId}
      width="full"
      borderTopWidth={divided ? "1px" : 0}
      borderColor="border.muted"
      paddingY={divided ? SETTINGS_BAND_PADDING_Y : 0}
      scrollMarginTop="72px"
      data-testid={testId}
    >
      <VStack width="full" align="stretch" gap={5}>
        <VStack width="full" align="stretch" gap={1}>
          <HStack width="full" gap={2} align="center">
            {icon ? (
              <Box color="fg.muted" display="flex" flexShrink={0}>
                {icon}
              </Box>
            ) : null}
            <Text as="h2" fontSize="md" fontWeight={600} letterSpacing="-0.01em">
              {title}
            </Text>
            {badge}
            {actions ? (
              <>
                <Spacer />
                {actions}
              </>
            ) : null}
          </HStack>
          {hint ? (
            <Text fontSize="sm" lineHeight="1.55" color="fg.muted">
              {hint}
            </Text>
          ) : null}
        </VStack>
        {children}
      </VStack>
    </Box>
  );
}

/** One half of a band that covers two things: a smaller label, no rule. */
export function SettingsSectionBlock({
  title,
  badge,
  children,
  "data-testid": testId,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <VStack width="full" align="stretch" gap={3} data-testid={testId}>
      <HStack width="full" gap={2} align="center">
        <Text fontSize="sm" fontWeight={600}>
          {title}
        </Text>
        {badge}
      </HStack>
      {children}
    </VStack>
  );
}

/** One item in a band's list (a passkey, a linked account, a browser). */
export function SettingsSectionRow({
  children,
  "data-testid": testId,
}: {
  children: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <HStack
      width="full"
      gap={3}
      paddingX={4}
      paddingY={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="10px"
      data-testid={testId}
    >
      {children}
    </HStack>
  );
}

/** A band with nothing in it yet: icon, what is missing, why, and the way in. */
export function SettingsEmptyState({
  icon,
  title,
  description,
  action,
  "data-testid": testId,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <EmptyState.Root
      size="sm"
      width="full"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="10px"
      paddingY={6}
      paddingX={5}
      data-testid={testId}
    >
      <EmptyState.Content>
        <EmptyState.Indicator color="fg.muted">{icon}</EmptyState.Indicator>
        <VStack gap={1} textAlign="center">
          <EmptyState.Title fontSize="sm" fontWeight={600}>
            {title}
          </EmptyState.Title>
          <EmptyState.Description fontSize="sm" color="fg.muted" maxWidth="46ch">
            {description}
          </EmptyState.Description>
        </VStack>
        {action ? <Box paddingTop={1}>{action}</Box> : null}
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
