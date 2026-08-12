import { HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import {
  describeNextFiring,
  type NextFiringResult,
} from "./nextFiringPresentation";

/**
 * "What happens next" — the other half of the in-depth view. The history says
 * what the automation has done; this says what it is going to do, and it is
 * the difference between a page that reports and a page that reassures.
 *
 * Every answer here is one the platform can actually stand behind: a
 * schedule's instant comes from the scheduler that owns the calendar entry, a
 * digest's from the same boundary the dispatcher would snap a match to, and
 * an alert gets a cadence rather than an invented instant.
 */
export function NextFiringSection({
  automationId,
  projectId,
}: {
  automationId: string;
  projectId: string;
}) {
  const nextFiringQuery = api.automation.getNextFiring.useQuery(
    { projectId, triggerId: automationId },
    { enabled: !!projectId, retry: false },
  );

  if (nextFiringQuery.isLoading) {
    return (
      <VStack align="start" gap={1} width="full">
        <SectionLabel />
        <Skeleton height="20px" width="220px" />
      </VStack>
    );
  }
  if (!nextFiringQuery.data) return null;

  const presentation = describeNextFiring(
    nextFiringQuery.data as NextFiringResult,
  );

  return (
    <VStack align="start" gap={1} width="full">
      <SectionLabel />
      <HStack gap={2} flexWrap="wrap">
        <Text textStyle="sm">{presentation.summary}</Text>
        {presentation.at ? (
          <Text textStyle="sm" fontWeight="medium">
            {formatAbsolute(presentation.at)}
          </Text>
        ) : null}
        {presentation.at ? (
          <Text textStyle="xs" color="fg.muted">
            {formatTimeAgo(presentation.at.getTime())}
          </Text>
        ) : null}
      </HStack>
      {presentation.caveat ? (
        <Text textStyle="xs" color="fg.muted">
          {presentation.caveat}
        </Text>
      ) : null}
    </VStack>
  );
}

function SectionLabel() {
  return (
    <Text textStyle="xs" color="fg.muted" fontWeight="medium">
      What happens next
    </Text>
  );
}

/** The reader's own locale and time zone — a scheduled send is a wall-clock
 *  promise, so it is shown as one. */
function formatAbsolute(at: Date): string {
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
