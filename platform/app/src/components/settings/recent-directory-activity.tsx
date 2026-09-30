import {
  Badge,
  Button,
  Collapsible,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { DirectoryActivityEntryView } from "@ee/scim/scim-reconciliation.types";
import { HandledErrorAlert } from "~/features/errors";
import { api } from "../../utils/api";
import { SettingsDisclosure } from "./SettingsDisclosure";

type ConnectionScope = { organizationId: string; connectionId: string };

export function RecentDirectoryActivity(scope: ConnectionScope) {
  return (
    <SettingsDisclosure summary="Recent directory activity">
      <Collapsible.Context>
        {({ open }) => (open ? <DirectoryActivityFeed {...scope} /> : null)}
      </Collapsible.Context>
    </SettingsDisclosure>
  );
}

function DirectoryActivityFeed(scope: ConnectionScope) {
  const activity = api.scimReconciliation.getActivity.useQuery(scope);
  const rows = activity.data ?? [];

  return (
    <VStack align="stretch" gap={3}>
      {activity.isLoading && (
        <VStack align="stretch" gap={2}>
          <Text role="status" fontSize="sm" color="fg.muted">
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
            dismissible={false}
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
        <VStack
          as="ol"
          aria-label="Recent directory activity"
          align="stretch"
          gap={3}
        >
          {rows.map((entry) => (
            <ActivityRow key={entry.eventId} entry={entry} />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function ActivityRow({ entry }: { entry: DirectoryActivityEntryView }) {
  return (
    <HStack as="li" align="start" gap={3}>
      <Badge colorPalette={entry.outcome === "refused" ? "orange" : "green"}>
        {entry.outcome === "refused" ? "Refused" : "Recorded"}
      </Badge>
      <VStack align="start" gap={0.5} minWidth={0}>
        <Text fontSize="sm">{entry.summary}</Text>
        <Text as="time" fontSize="xs" color="fg.muted">
          {new Date(entry.occurredAtMs).toLocaleString()}
        </Text>
      </VStack>
    </HStack>
  );
}
