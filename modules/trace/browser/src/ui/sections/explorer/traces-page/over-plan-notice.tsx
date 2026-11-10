import { Link as RoutedLink } from "@langwatch/browser-host/link";
import { Alert, Button, HStack } from "@langwatch/design-system/primitives";

import type { TraceListWithheld } from "../../../../features/explorer/behavior/use-trace-list-query.ts";

const members = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;

/**
 * The one line the traces page shows while the organization is over its plan: newer traces are
 * held by the server until the card is updated or the members fit.
 * @see specs/billing/over-plan-trace-withholding.feature
 */
export function OverPlanNotice({ withheld }: { withheld: TraceListWithheld | null }) {
  if (!withheld) return null;
  const toRemove = Math.max(withheld.members - withheld.maxMembers, 0);

  return (
    <Alert.Root status="warning" size="sm" borderRadius={0} data-testid="over-plan-notice">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          Your plan covers {members(withheld.maxMembers)} and you have {withheld.members}. New
          traces are saved and will show once you update your card or remove {members(toRemove)}.
        </Alert.Description>
      </Alert.Content>
      <HStack gap={2} flexShrink={0}>
        <Button asChild size="xs" variant="solid" colorPalette="orange">
          <RoutedLink href="/settings/subscription?updateCard=1">Update card</RoutedLink>
        </Button>
        <Button asChild size="xs" variant="outline">
          <RoutedLink href="/settings/members">Manage members</RoutedLink>
        </Button>
      </HStack>
    </Alert.Root>
  );
}
