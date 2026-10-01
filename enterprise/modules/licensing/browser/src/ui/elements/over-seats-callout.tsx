import { Link } from "@langwatch/browser-host/link";
import { Alert, Button, HStack } from "@langwatch/design-system/primitives";

interface OverSeatsCalloutProps {
  currentMembers: number;
  maxMembers: number;
}

// Shown when an organization has more active members than the license covers.
// Normal state after activation, not an error.
export function OverSeatsCallout({ currentMembers, maxMembers }: OverSeatsCalloutProps) {
  const overBy = currentMembers - maxMembers;

  if (overBy <= 0) return null;

  return (
    <Alert.Root status="warning" data-testid="over-seats-callout">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {overBy === 1
            ? "One member is over the seats your license covers"
            : `${overBy} members are over the seats your license covers`}
        </Alert.Title>
        <Alert.Description>
          Your license covers {maxMembers} {maxMembers === 1 ? "seat" : "seats"} and{" "}
          {currentMembers} members are active. Everyone keeps working, but you cannot add anyone new
          until you are back within {maxMembers}. Disable the members who no longer need access, or
          talk to us about more seats.
        </Alert.Description>
        <HStack gap={3} paddingTop={2}>
          <Button asChild size="sm" variant="outline" colorPalette="orange">
            <Link unstyled href="/settings/members">
              Choose who to disable
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href="mailto:enterprise@langwatch.ai">Get more seats</a>
          </Button>
        </HStack>
      </Alert.Content>
    </Alert.Root>
  );
}
