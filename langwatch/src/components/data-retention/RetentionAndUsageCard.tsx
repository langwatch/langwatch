import {
  Card,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
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
}: {
  effective: Partial<Record<RetentionCategory, number>>;
  isLoading: boolean;
  data?: { totalBytes: number; byCategory: Record<RetentionCategory, number> };
}) {
  const summary = renderPolicySummary(effective);
  return (
    <Card.Root width="full">
      <Card.Header>
        <HStack width="full" justify="space-between" align="start">
          <VStack align="start" gap={0}>
            <Heading as="h3" fontSize="lg">
              Data Retention
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              How long this project's data is kept before deletion.
            </Text>
          </VStack>
          <Text fontWeight="semibold" flexShrink={0}>
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
              <Heading as="h3" fontSize="lg">
                Data Storage
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                How much space this project's data uses today.
              </Text>
            </VStack>
            {isLoading ? (
              <Spinner size="sm" />
            ) : data ? (
              <Text fontWeight="semibold" flexShrink={0}>
                {formatBytes(data.totalBytes)}
              </Text>
            ) : null}
          </HStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
