import {
  Button,
  Card,
  Heading,
  HStack,
  Progress,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { MutationProgress } from "~/server/data-retention/retroactive/retroactiveUpdate.service";
import { CATEGORY_LABELS } from "./constants";

export function RetroactiveProgressCard({
  mutations,
  onCancel,
  isCancelling,
}: {
  mutations: MutationProgress[];
  onCancel: (mutationId: string) => void;
  isCancelling: boolean;
}) {
  if (mutations.length === 0) return null;
  return (
    <Card.Root width="full">
      <Card.Header>
        <Heading as="h3" fontSize="lg">
          Applying retention to existing data
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          ClickHouse rewrites the affected parts during background merges. Large
          datasets can take a while; the count below is parts still pending.
        </Text>
      </Card.Header>
      <Card.Body>
        <VStack gap={4} align="stretch">
          {mutations.map((m) => (
            <VStack key={m.mutationId} gap={1} align="stretch">
              <HStack justifyContent="space-between">
                <Text>
                  {m.table}
                  {m.category ? ` · ${CATEGORY_LABELS[m.category]}` : ""}
                </Text>
                <HStack gap={3}>
                  <Text fontSize="sm" color="fg.muted">
                    {m.partsToDo} parts remaining
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
          ))}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
