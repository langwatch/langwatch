// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Card, Box, Heading, HStack, Spacer } from "@langwatch/design-system/primitives";
import { type ReactNode } from "react";

import { SampleMark } from "./sample-mark.tsx";

/** Showcase panel; invented figures keep their sample mark unless the page banner covers them. */
export function CostPanel({
  title,
  sample = false,
  action,
  tourId,
  children,
}: {
  title: string;
  sample?: boolean;
  action?: ReactNode;
  /** The `data-tour` target the guided tour spotlights on this panel. */
  tourId?: string;
  children: ReactNode;
}) {
  return (
    <Card.Root
      variant="showcase"
      data-testid="cost-panel"
      data-tour={tourId}
      alignItems="stretch"
      gap={3}
      padding={4}
    >
      <HStack gap={2}>
        <Heading size="sm">{title}</Heading>
        <SampleMark shown={sample} />
        <Spacer />
        {action}
      </HStack>
      <Box>{children}</Box>
    </Card.Root>
  );
}
