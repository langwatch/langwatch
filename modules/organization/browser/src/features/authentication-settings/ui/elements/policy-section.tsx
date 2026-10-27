import { Card } from "@langwatch/design-system/card";
import { VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export function PolicySection({
  title,
  hint,
  badge,
  actions,
  children,
  "data-testid": testId,
}: {
  title: string;
  hint: string;
  badge?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  "data-testid": string;
}) {
  return (
    <Card
      titleLevel={3}
      title={title}
      description={hint}
      badge={badge}
      footer={actions}
      padding="sm"
      data-testid={testId}
    >
      <VStack align="stretch" gap={1.5}>
        {children}
      </VStack>
    </Card>
  );
}
