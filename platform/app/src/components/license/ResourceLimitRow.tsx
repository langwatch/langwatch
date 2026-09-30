import { Card, Text, VStack } from "@chakra-ui/react";
import { formatLimitOrUnlimited } from "./licenseStatusUtils";

export interface ResourceLimitRowProps {
  label: string;
  current: number;
  max?: number;
}

/**
 * One seat count against its limit, as the same quiet tile the directory
 * summary band draws its facts in: the label in small muted ink, the figure
 * below it in the band's tabular number. It sits on the same page as those
 * tiles, and a differently-drawn box for the same kind of fact read as a
 * different product.
 */
export function ResourceLimitRow({
  label,
  current,
  max,
}: ResourceLimitRowProps) {
  return (
    <Card.Root borderRadius="xl" minWidth={0}>
      <Card.Body paddingX={4} paddingY={3}>
        <VStack align="start" gap={1.5} minWidth={0}>
          <Text
            fontSize="xs"
            color="fg.muted"
            fontWeight={500}
            lineHeight="1.3"
          >
            {label}
          </Text>
          <Text
            fontSize="lg"
            lineHeight="1.3"
            fontWeight={600}
            letterSpacing="-0.01em"
            fontVariantNumeric="tabular-nums"
          >
            {current.toLocaleString()}
            {max != null && (
              <Text
                as="span"
                fontSize="sm"
                fontWeight="normal"
                color="fg.muted"
              >
                {" "}
                / {formatLimitOrUnlimited(max)}
              </Text>
            )}
          </Text>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
