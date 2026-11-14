/**
 * What a plan includes, as checked lines in equal columns. The list keeps a reading width, so
 * a wide card does not spread three short lines across the page.
 */
import { Box, HStack, SimpleGrid, Text } from "@langwatch/design-system/primitives";
import { Check } from "lucide-react";

export function PlanFeatureList({
  features,
  "data-testid": testId,
  itemTestId,
}: {
  features: readonly string[];
  "data-testid"?: string;
  itemTestId?: string;
}) {
  return (
    <SimpleGrid
      as="ul"
      listStyleType="none"
      data-testid={testId}
      templateColumns={{
        base: "minmax(0, 1fr)",
        sm: "repeat(2, minmax(0, 1fr))",
        lg: "repeat(3, minmax(0, 1fr))",
      }}
      maxWidth="4xl"
      rowGap={2}
      columnGap={6}
    >
      {features.map((feature) => (
        <HStack as="li" key={feature} gap={2} alignItems="start" data-testid={itemTestId}>
          <Box color="fg.success" flexShrink={0} paddingTop={1}>
            <Check size={12} aria-hidden />
          </Box>
          <Text textStyle="bodySm" color="fg.muted">
            {feature}
          </Text>
        </HStack>
      ))}
    </SimpleGrid>
  );
}
