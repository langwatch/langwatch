import type { RetentionCategory } from "@langwatch/data-retention-contract";
import { Card } from "@langwatch/design-system/card";
import { Button, HStack, Progress, Text, VStack } from "@langwatch/design-system/primitives";

import { CATEGORY_LABELS } from "../../model/retention-constants.ts";

/** The fields the progress card reads off a ClickHouse mutation. The
 *  canonical shape lives server-side (`MutationProgress`); this is the
 *  narrow, browser-safe slice this presentation actually needs. */
export type RetentionMutationProgress = {
  mutationId: string;
  table: string;
  category: RetentionCategory | null;
  partsToDo: number;
};

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function labelOf(m: RetentionMutationProgress): string {
  return m.category ? sentenceCase(CATEGORY_LABELS[m.category]) : "Stored data";
}

export function RetroactiveProgressCard({
  mutations,
  onCancel,
  isCancelling,
}: {
  mutations: RetentionMutationProgress[];
  onCancel: (mutationId: string) => void;
  isCancelling: boolean;
}) {
  if (mutations.length === 0) return null;
  return (
    <Card
      title="Applying retention to existing data"
      description="Applying your retention policy to existing data can take a while."
      padding="lg"
    >
      <VStack gap={4} align="stretch">
        {mutations.map((m, index) => {
          const label = labelOf(m);
          const sameLabel = mutations.filter((o) => labelOf(o) === label);
          return (
            <VStack key={`${m.mutationId}:${index}`} gap={1} align="stretch">
              <HStack justifyContent="space-between">
                <HStack gap={2}>
                  <Text>{label}</Text>
                  {sameLabel.length > 1 && (
                    <Text textStyle="caption" color="fg.muted">
                      Update {sameLabel.indexOf(m) + 1}
                    </Text>
                  )}
                </HStack>
                <HStack gap={3}>
                  <Text fontSize="sm" color="fg.muted">
                    In progress
                  </Text>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    loading={isCancelling}
                    onClick={() => onCancel(m.mutationId)}
                  >
                    Cancel
                  </Button>
                </HStack>
              </HStack>
              <Progress.Root value={null} size="xs" colorPalette="blue">
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </VStack>
          );
        })}
      </VStack>
    </Card>
  );
}
