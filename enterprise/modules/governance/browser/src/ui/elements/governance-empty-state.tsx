/**
 * Empty state component with customizable copy and optional action button; shared shape
 * from Langy with per-caller text (one shape, many voices).
 */

import { Button, type ButtonProps, HStack } from "@chakra-ui/react";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import type { ComponentType, PropsWithChildren, ReactNode } from "react";

/** Structural, so a lucide glyph and any other icon library both satisfy it. */
export type GovernanceEmptyStateIcon = ComponentType<{
  size?: string | number;
}>;

/**
 * Action button for empty states with primary (create) and secondary (view) emphasis.
 */
export function GovernanceEmptyStateAction({
  children,
  emphasis = "primary",
  ...props
}: PropsWithChildren<
  ButtonProps & {
    emphasis?: "primary" | "secondary";
  }
>) {
  if (emphasis === "primary") {
    return <PageLayout.HeaderButton {...props}>{children}</PageLayout.HeaderButton>;
  }

  return (
    <Button size="sm" variant="ghost" {...props}>
      {children}
    </Button>
  );
}

export function GovernanceEmptyState({
  icon: Icon,
  headline,
  description,
  action,
  secondaryAction,
  testId,
}: {
  icon: GovernanceEmptyStateIcon;
  /** The state, not a fault. "No agents registered yet", not "No agents". */
  headline: string;
  /** One sentence saying why it is empty and what fills it. Two if the second earns itself. */
  description: string;
  /** The move that changes the state. Omit only when the reader has none. */
  action?: ReactNode;
  /** A second, quieter way out. At most one: three choices is a menu. */
  secondaryAction?: ReactNode;
  testId?: string;
}) {
  return (
    <NoDataInfoBlock
      testId={testId}
      icon={<Icon size={20} />}
      title={headline}
      description={description}
    >
      {(action ?? secondaryAction) ? (
        <HStack gap={2}>
          {action}
          {secondaryAction}
        </HStack>
      ) : null}
    </NoDataInfoBlock>
  );
}
