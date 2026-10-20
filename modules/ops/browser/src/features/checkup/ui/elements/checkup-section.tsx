import { Card } from "@langwatch/design-system/card";
import { HStack, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** One checkup section composed from the shared outline card. */
export function CheckupSection({
  icon,
  title,
  description,
  action,
  testId,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Card title={title} description={description} icon={icon} actions={action} data-testid={testId}>
      <VStack align="stretch" gap={5}>
        {children}
      </VStack>
    </Card>
  );
}

/** A nested checkup item using the shared subtle card. */
export function CheckupSectionRow({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <Card variant="nested" data-testid={testId}>
      <HStack gap={3} align="start" minWidth={0} wrap="wrap">
        {children}
      </HStack>
    </Card>
  );
}
