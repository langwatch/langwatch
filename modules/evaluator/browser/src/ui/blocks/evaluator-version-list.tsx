import type { WireOf } from "@langwatch/api/web";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { EvaluatorVersion } from "@langwatch/evaluator-contract";
import { toEpochMs } from "@langwatch/time";

/** Every saved version of an evaluator, newest first, with the deploy labels it carries. */
export function EvaluatorVersionList({ versions }: { versions: WireOf<EvaluatorVersion>[] }) {
  return (
    <VStack align="stretch" gap={2} data-testid="evaluator-versions">
      <Text fontWeight="semibold" fontSize="sm">
        Versions
      </Text>
      {versions.map((row) => (
        <VStack
          key={row.id}
          align="start"
          gap={0}
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          paddingX={3}
          paddingY={2}
        >
          <HStack gap={2}>
            <Text fontFamily="mono" fontSize="sm" fontWeight="semibold">
              v{row.version}
            </Text>
            {row.labels.map((label) => (
              <Badge key={label} size="xs" variant="subtle" colorPalette="green">
                {label}
              </Badge>
            ))}
          </HStack>
          {row.commitMessage && (
            <Text fontSize="sm" truncate maxWidth="100%">
              {row.commitMessage}
            </Text>
          )}
          <Text color="fg.muted" fontSize="xs">
            {authorOf(row)} · {formatTimeAgo(toEpochMs(row.createdAt))}
          </Text>
        </VStack>
      ))}
    </VStack>
  );
}

function authorOf(row: WireOf<EvaluatorVersion>): string {
  if (row.author) return row.author.name ?? row.author.email ?? "Unknown user";
  return row.authorKind === "api_key" ? "API key" : "LangWatch";
}
