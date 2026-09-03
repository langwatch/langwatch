import { Card, HStack, Icon, Text } from "@chakra-ui/react";
import { CheckCircle2 } from "lucide-react";

export interface HealthLineProps {
  errorClusterCount: number;
  anomalyCount: number;
  /** False unless the anomaly query succeeded; a failed check is not clear. */
  anomaliesKnown: boolean;
}

/** Compact all-clear state for the ops dashboard. */
export function HealthLine({ errorClusterCount, anomalyCount, anomaliesKnown }: HealthLineProps) {
  if (errorClusterCount > 0 || anomalyCount > 0 || !anomaliesKnown) return null;

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
