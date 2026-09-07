import { Card, GridItem, Heading, HStack } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { BarChart2 } from "react-feather";

export function ChartCard({
  title,
  children,
  colSpan,
}: PropsWithChildren<{ title: string; colSpan?: number }>) {
  return (
    <GridItem colSpan={colSpan} display="inline-grid">
      <Card.Root>
        <Card.Header>
          <HStack gap={2}>
            <BarChart2 color="orange" />
            <Heading size="sm">{title}</Heading>
          </HStack>
        </Card.Header>
        <Card.Body>{children}</Card.Body>
      </Card.Root>
    </GridItem>
  );
}
