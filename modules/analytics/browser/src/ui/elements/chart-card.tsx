import { Card, GridItem, Heading } from "@langwatch/design-system/primitives";
import type { PropsWithChildren } from "react";

export function ChartCard({
  title,
  children,
  colSpan,
}: PropsWithChildren<{ title: string; colSpan?: number }>) {
  return (
    <GridItem colSpan={colSpan} display="inline-grid">
      <Card.Root>
        <Card.Header>
          <Heading textStyle="cardTitle">{title}</Heading>
        </Card.Header>
        <Card.Body>{children}</Card.Body>
      </Card.Root>
    </GridItem>
  );
}
