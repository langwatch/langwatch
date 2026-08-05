import { Card, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import {
  RETENTION_CATEGORIES,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import { CATEGORY_LABELS } from "./constants";
import { formatBytes, formatDays } from "./format";
import { renderPolicySummary } from "./grouping";

export function RetentionAndUsageCard({
  effective,
  isLoading,
  data,
  storageDescription = "How much space this project's data uses today.",
}: {
  effective: Partial<Record<RetentionCategory, number>>;
  isLoading: boolean;
  data?: { totalBytes: number; projectCount?: number };
  /** Scope-aware copy for the storage row — the storage total tracks the
   *  page's scope selector, so the sentence must match (project / team / org /
   *  everything you can see). */
  storageDescription?: string;
}) {
  const summary = renderPolicySummary(effective);
  return (
    <Card.Root width="full">
      <Card.Header>
        <HStack width="full" justify="space-between" align="start">
          <VStack align="start" gap={0}>
            <Heading as="h3" fontSize="sm" fontWeight="semibold">
              Data Retention
            </Heading>
            <Text fontSize="xs" color="fg.muted">
              How long this project's data is kept before deletion.
            </Text>
          </VStack>
          <Text fontSize="sm" fontWeight="semibold" flexShrink={0}>
            {summary}
          </Text>
        </HStack>
      </Card.Header>
      <Card.Body>
        <VStack gap={5} align="stretch">
          {summary === "Mixed" && (
            <VStack gap={2} align="stretch">
              {RETENTION_CATEGORIES.map((category) => (
                <HStack key={category} justifyContent="space-between">
                  <Text color="fg.muted">{CATEGORY_LABELS[category]}</Text>
                  <Text>
                    {effective[category] !== undefined
                      ? formatDays(effective[category]!)
                      : "—"}
                  </Text>
                </HStack>
              ))}
            </VStack>
          )}
          <HStack width="full" justify="space-between" align="start">
            <VStack align="start" gap={0}>
              <Heading as="h3" fontSize="sm" fontWeight="semibold">
                Data Storage
              </Heading>
              <Text fontSize="xs" color="fg.muted">
                {storageDescription}
              </Text>
            </VStack>
            {isLoading ? (
              <Spinner size="sm" />
            ) : data ? (
              <HStack gap={1.5} flexShrink={0} align="baseline">
                <Text fontSize="sm" fontWeight="semibold">
                  {formatBytes(data.totalBytes)}
                </Text>
                {data.projectCount !== undefined && data.projectCount > 1 && (
                  <Text fontSize="xs" color="fg.muted">
                    · {data.projectCount} projects
                  </Text>
                )}
              </HStack>
            ) : null}
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
