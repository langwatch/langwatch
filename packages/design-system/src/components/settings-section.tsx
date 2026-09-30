/**
 * The head of a settings page's section: a small icon and a title, one line of
 * what the section is for, and an optional action on the right. The body
 * follows as children. Presentational only.
 */
import { HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface SettingsSectionProps {
  /** An 18px lucide icon. */
  icon: ReactNode;
  title: string;
  hint?: ReactNode;
  /** The section's one action, aligned with the title. */
  actions?: ReactNode;
  children?: ReactNode;
  "data-testid"?: string;
}

export function SettingsSection({
  icon,
  title,
  hint,
  actions,
  children,
  "data-testid": testId,
}: SettingsSectionProps) {
  return (
    <VStack align="start" gap={4} width="full" data-testid={testId}>
      <VStack align="start" gap={1} width="full">
        <HStack gap={2} width="full">
          {icon}
          <Text as="h2" fontWeight={600}>
            {title}
          </Text>
          <Spacer />
          {actions}
        </HStack>
        {hint && (
          <Text fontSize="sm" color="fg.muted">
            {hint}
          </Text>
        )}
      </VStack>
      {children}
    </VStack>
  );
}
