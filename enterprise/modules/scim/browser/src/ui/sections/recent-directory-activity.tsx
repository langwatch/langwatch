// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What the directory did on one connection, newest first, read only while open (ADR-126). */
import { Badge, Box, Button, Collapsible, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { HandledErrorAlert } from "@langwatch/error-views";
import { ChevronRight } from "lucide-react";

import { scimApi, type DirectoryActivityRow } from "../../behavior/scim-api.ts";
import { readableDate } from "../../model/display-formatters.ts";

type ConnectionScope = { organizationId: string; connectionId: string };

export function RecentDirectoryActivity(scope: ConnectionScope) {
  return (
    <Collapsible.Root>
      <Collapsible.Trigger asChild>
        <Button
          variant="ghost"
          size="xs"
          paddingX={0}
          color="fg.muted"
          fontWeight={500}
          alignSelf="start"
          _hover={{ color: "fg" }}
        >
          <Box
            asChild
            transition="transform 0.15s ease"
            css={{ "[data-state=open] &": { transform: "rotate(90deg)" } }}
          >
            <ChevronRight size={14} />
          </Box>
          Recent directory activity
        </Button>
      </Collapsible.Trigger>
      <Collapsible.Content>
        <Box
          paddingTop={2}
          paddingLeft={3}
          marginLeft="7px"
          borderLeftWidth="1px"
          borderColor="border.muted"
        >
          <Collapsible.Context>
            {({ open }) => (open ? <DirectoryActivityFeed {...scope} /> : null)}
          </Collapsible.Context>
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function DirectoryActivityFeed(scope: ConnectionScope) {
  const activity = scimApi.scimReconciliation.getActivity.useQuery(scope);
  const rows = activity.data ?? [];

  return (
    <VStack align="stretch" gap={3}>
      {activity.isLoading && (
        <VStack align="stretch" gap={2}>
          <Text as="output" fontSize="sm" color="fg.muted">
            Loading recent directory activity…
          </Text>
          <Skeleton height="4" width="60%" />
        </VStack>
      )}
      {activity.isError && (
        <VStack align="stretch" gap={2}>
          <HandledErrorAlert
            error={activity.error}
            fallbackTitle="We couldn't load recent directory activity"
            onRetry={() => void activity.refetch()}
          />
          <Button
            alignSelf="start"
            size="xs"
            variant="ghost"
            disabled={activity.isFetching}
            onClick={() => void activity.refetch()}
          >
            Retry activity
          </Button>
        </VStack>
      )}
      {!activity.isLoading && !activity.isError && rows.length === 0 && (
        <Text fontSize="sm" color="fg.muted">
          No recent directory activity is recorded for this connection.
        </Text>
      )}
      {rows.length > 0 && (
        <VStack as="ol" aria-label="Recent directory activity" align="stretch" gap={3}>
          {rows.map((entry) => (
            <ActivityRow key={entry.eventId} entry={entry} />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function ActivityRow({ entry }: { entry: DirectoryActivityRow }) {
  const refused = entry.outcome === "refused";
  return (
    <HStack as="li" align="start" gap={3}>
      <Badge colorPalette={refused ? "orange" : "green"}>{refused ? "Refused" : "Recorded"}</Badge>
      <VStack align="start" gap={0.5} minWidth={0}>
        <Text fontSize="sm">{entry.summary}</Text>
        <Text as="time" fontSize="xs" color="fg.muted">
          {readableDate(entry.occurredAtMs).toLocaleString()}
        </Text>
      </VStack>
    </HStack>
  );
}
