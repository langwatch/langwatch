import { Card, HStack, Icon, Text } from "@chakra-ui/react";
import { CheckCircle2 } from "lucide-react";

/**
 * The all-clear, in one line.
 *
 * Errors and tenant anomalies each used to render a full card whose entire
 * content was "No errors" / "No active anomalies" — a third of a viewport spent
 * confirming that nothing happened. Space on this page is meant to be
 * proportional to trouble, so when both are clear they collapse to this; when
 * either has something to say, it expands into its own panel instead.
 */
export function HealthLine({
  errorClusterCount,
  anomalyCount,
}: {
  errorClusterCount: number;
  anomalyCount: number;
}) {
  if (errorClusterCount > 0 || anomalyCount > 0) return null;

  return (
    <Card.Root overflow="hidden">
      <HStack paddingX={4} paddingY={2} gap={2} data-testid="ops-health-line">
        <Icon color="green.500" boxSize={3.5}>
          <CheckCircle2 />
        </Icon>
        <Text textStyle="xs" color="fg.muted">
          No errors and no anomalous tenants
        </Text>
      </HStack>
    </Card.Root>
  );
}
