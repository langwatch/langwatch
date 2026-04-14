import { Badge, Box, Card, HStack, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import NextLink from "next/link";
import { formatDuration } from "~/components/ops/shared/formatters";
import { replayStateColor } from "~/components/ops/shared/ReplayStateBadge";
import { api } from "~/utils/api";

export function ReplayHistorySection() {
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const latestEntry = historyQuery.data?.[0];

  return (
    <Card.Root overflow="hidden">
      <NextLink href="/ops/projections" style={{ textDecoration: "none" }}>
        <HStack
          paddingX={4}
          paddingTop={3}
          paddingBottom={2}
          cursor="pointer"
          _hover={{ color: "orange.500" }}
          transition="color 0.1s"
        >
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Latest Replay
          </Text>
          <ArrowUpRight size={10} />
        </HStack>
      </NextLink>
      <Box paddingX={4} paddingBottom={4}>
        {latestEntry ? (
          <NextLink
            href={`/ops/projections/${latestEntry.runId}`}
            style={{ textDecoration: "none" }}
          >
            <HStack
              gap={3}
              cursor="pointer"
              _hover={{ opacity: 0.8 }}
              transition="opacity 0.1s"
            >
              <Badge
                size="sm"
                variant="subtle"
                colorPalette={replayStateColor(latestEntry.state)}
              >
                {latestEntry.state}
              </Badge>
              <Text textStyle="xs" truncate maxWidth="240px">
                {latestEntry.description || "\u2014"}
              </Text>
              <Text textStyle="xs" color="fg.muted">
                {formatDuration(latestEntry.startedAt, latestEntry.completedAt)}
              </Text>
              <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                {latestEntry.completedAt
                  ? new Date(latestEntry.completedAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "\u2014"}
              </Text>
            </HStack>
          </NextLink>
        ) : (
          <Text textStyle="xs" color="fg.muted">
            No replay history
          </Text>
        )}
      </Box>
    </Card.Root>
  );
}
