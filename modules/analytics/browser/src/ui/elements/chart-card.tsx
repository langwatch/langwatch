import { Card } from "@langwatch/design-system/card";
import { GridItem } from "@langwatch/design-system/primitives";
import type { PropsWithChildren } from "react";

export function ChartCard({
  title,
  children,
  colSpan,
}: PropsWithChildren<{ title: string; colSpan?: number }>) {
  return (
    <GridItem colSpan={colSpan} display="inline-grid">
      <Card title={title} padding="lg">
        {children}
      </Card>
    </GridItem>
  );
}
