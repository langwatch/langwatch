import { HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/automation-api.ts";
import { formatTimeAgo } from "../../../../model/relative-time.ts";
import { describeNextFiring } from "../../model/next-firing-presentation.ts";

/**
 * "What happens next": the history says what the automation has done, this
 * says what it will do. A schedule's instant comes from the scheduler, a
 * digest's from the dispatcher's boundary, and an alert gets a cadence.
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

  const presentation = describeNextFiring(nextFiringQuery.data);

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
            {formatTimeAgo(presentation.at)}
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

/** A scheduled send is a wall-clock promise: the reader's own locale and time zone. */
function formatAbsolute(at: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(at);
}
