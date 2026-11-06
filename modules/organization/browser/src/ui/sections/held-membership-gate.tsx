import { AccessState } from "@langwatch/design-system/access-state";
/**
 * Lent to onboarding's welcome: somebody whose only memberships are held (over the seat limit,
 * or turned off by an administrator) reads who to contact instead of creating an organization.
 * Spec: modules/organization/specs/seat-requests.feature
 */
import { Box, Button, Spinner } from "@langwatch/design-system/primitives";
import type { HeldMembership } from "@langwatch/organization-contract";
import type { ReactNode } from "react";

import { api } from "../../behavior/organization-api.ts";
import { useOrganizationHost } from "../../model/organization-host.ts";

export default function HeldMembershipGate({ children }: { children: ReactNode }) {
  const held = api.seatRequest.myHeldMemberships.useQuery({});

  if (held.isPending) {
    return (
      <Box display="flex" justifyContent="center" padding={10}>
        <Spinner />
      </Box>
    );
  }
  const first = held.data?.held[0];
  if (held.isError || !first || held.data?.hasActiveMembership) return <>{children}</>;
  return <HeldMembershipScreen membership={first} onCheckAgain={() => void held.refetch()} />;
}

export function HeldMembershipScreen({
  membership,
  onCheckAgain,
}: {
  membership: HeldMembership;
  onCheckAgain: () => void;
}) {
  const host = useOrganizationHost();
  const contacts = membership.contacts.map((contact) => contact.name).join(", ");
  const contactLine = contacts ? ` Contact one of them: ${contacts}.` : "";
  const overLimit = membership.reason === "seat_limit";

  return (
    <Box maxWidth="640px" marginX="auto" paddingY={12} paddingX={4}>
      <AccessState
        kind="permission"
        data-testid="held-membership-screen"
        title={
          overLimit
            ? `${membership.organizationName} is over its seat limit`
            : `Your access to ${membership.organizationName} is turned off`
        }
        description={
          overLimit
            ? `We've asked your administrators to approve a seat.${contactLine}`
            : `An administrator turned off your access to ${membership.organizationName}.${contactLine}`
        }
        actions={
          <>
            <Button size="sm" colorPalette="orange" onClick={onCheckAgain}>
              Check again
            </Button>
            <Button size="sm" variant="ghost" onClick={() => host.signOut()}>
              Sign out
            </Button>
          </>
        }
      />
    </Box>
  );
}
