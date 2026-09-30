import { Alert, Badge, HStack, Text, VStack } from "@chakra-ui/react";

import { readableDate } from "../../model/display-formatters.ts";
import type { AutomaticJoin } from "../../model/pending-join-request.ts";
import { RandomColorAvatar } from "./random-color-avatar.tsx";

/**
 * Who joined without anybody approving (D12), and what admitted them: the
 * in-product half of the mail every admin gets. Renders nothing when nobody
 * walked in, which is every organization without automatic joining.
 */
export function AutomaticJoinsNotice({ joins }: { joins: AutomaticJoin[] }) {
  if (joins.length === 0) return null;

  return (
    <Alert.Root status="info" width="full" marginTop={4} data-testid="automatic-joins-notice">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {joins.length === 1
            ? "Somebody joined automatically"
            : `${joins.length} colleagues joined automatically`}
        </Alert.Title>
        <Alert.Description>
          <VStack align="start" gap={2} paddingTop={1} width="full">
            <Text>
              Your domain setting admitted them with your organization&apos;s default role. Nobody
              approved these.
            </Text>
            {joins.map((join) => (
              <HStack key={join.joinRequestId} gap={2}>
                <RandomColorAvatar size="2xs" name={join.name} />
                <Text fontWeight="medium">{join.name}</Text>
                <Badge>{join.domain}</Badge>
                {join.joinedAt ? (
                  <Text color="fg.muted" fontSize="sm">
                    {formatDay(join.joinedAt)}
                  </Text>
                ) : null}
              </HStack>
            ))}
          </VStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/** Spelled out, never abbreviated: "24 Aug 2026", not "24/08". */
function formatDay(date: Date | string): string {
  return readableDate(date).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
