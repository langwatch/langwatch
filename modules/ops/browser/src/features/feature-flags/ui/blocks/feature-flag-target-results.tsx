import { Card } from "@langwatch/design-system/card";
import { Badge, Button, HStack, VStack } from "@langwatch/design-system/primitives";
import type { OpsFeatureFlagTarget } from "@langwatch/ops-contract";

import { FeatureFlagTargetSummary } from "../elements/feature-flag-target-summary.tsx";

/** The targets a search found, each a button that picks it; ones the rule holds read "added". */
export function FeatureFlagTargetResults({
  label,
  results,
  heldIds,
  onPick,
}: {
  label: string;
  results: OpsFeatureFlagTarget[];
  heldIds: string[];
  onPick: (target: OpsFeatureFlagTarget) => void;
}) {
  return (
    <Card variant="elevated" padding="xs">
      <VStack align="stretch" gap={0.5} maxHeight="72" overflowY="auto" aria-label={label}>
        {results.map((result) => {
          const held = heldIds.includes(result.id);
          return (
            <Button
              key={result.id}
              aria-pressed={held}
              variant="ghost"
              justifyContent="start"
              height="auto"
              whiteSpace="normal"
              paddingY={1.5}
              onClick={() => onPick(result)}
            >
              <HStack gap={2} width="full" minWidth={0}>
                <FeatureFlagTargetSummary target={result} />
                {held && (
                  <Badge size="sm" colorPalette="green" marginStart="auto">
                    added
                  </Badge>
                )}
              </HStack>
            </Button>
          );
        })}
      </VStack>
    </Card>
  );
}
