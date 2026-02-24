/**
 * Panel displaying archived suites with restore action.
 *
 * Shows an empty state when no suites are archived, or a list
 * of archived suites with their archived date and a restore button.
 */

import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import type { SimulationSuite } from "@prisma/client";
import { Archive, RotateCcw } from "lucide-react";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

export function ArchivedSuitesPanel({
  suites,
  onRestore,
  isRestoring,
}: {
  suites: SimulationSuite[];
  onRestore: (id: string) => void;
  isRestoring: boolean;
}) {
  if (suites.length === 0) {
    return (
      <VStack gap={4} align="center" py={12}>
        <Archive size={40} color="var(--chakra-colors-fg-muted)" />
        <Text color="fg.muted">No archived suites</Text>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={2} padding={4}>
      <Text fontSize="lg" fontWeight="medium" paddingBottom={2}>
        Archived Suites
      </Text>
      {suites.map((suite) => (
        <HStack
          key={suite.id}
          paddingX={4}
          paddingY={3}
          borderRadius="md"
          border="1px solid"
          borderColor="border"
          justify="space-between"
        >
          <VStack align="start" gap={0}>
            <Text fontSize="sm" fontWeight="medium">
              {suite.name}
            </Text>
            {suite.archivedAt && (
              <Text fontSize="xs" color="fg.muted">
                Archived {formatTimeAgo(new Date(suite.archivedAt).getTime())}
              </Text>
            )}
          </VStack>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRestore(suite.id)}
            disabled={isRestoring}
          >
            <RotateCcw size={14} />
            Restore
          </Button>
        </HStack>
      ))}
    </VStack>
  );
}
