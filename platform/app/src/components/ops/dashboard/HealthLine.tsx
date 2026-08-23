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
  anomaliesKnown,
}: {
  errorClusterCount: number;
  anomalyCount: number;
  /** False unless the anomaly query SUCCEEDED — a failed one is not an answer. */
  anomaliesKnown: boolean;
}) {
  if (errorClusterCount > 0 || anomalyCount > 0) return null;
  // Say nothing rather than say "clear" on an answer we do not have. An
  // all-clear the operator cannot trust is worse than no line at all.
  if (!anomaliesKnown) return null;

  return (
    <Card.Root overflow="hidden">
      <HStack paddingX={4} paddingY={2} gap={2} data-testid="ops-health-line">
        <Icon color="green.solid" boxSize={3.5}>
          <CheckCircle2 />
        </Icon>
        <Text textStyle="xs" color="fg.muted">
          No errors and no anomalous tenants
        </Text>
      </HStack>
    </Card.Root>
  );
}
