import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Button, Text, VStack } from "@langwatch/design-system/primitives";
import type { JoinOfferProps } from "@langwatch/organization-client";
import type { ReactNode } from "react";

import { useOrganizationHost } from "../../../../model/organization-host.ts";
import { orgRoleOptions } from "../../../../ui/elements/organization-user-role-field.tsx";
import { useJoinOffer } from "../../behavior/use-join-offer.ts";

/**
 * The post-login offer: "your colleagues are already here", or the wait after
 * asking. A dashboard names its organization to scope the pending request;
 * onboarding omits it so any request still blocks creating a second one.
 */
export function JoinYourTeamTakeover({
  dismissLabel = "Not now, keep working on my own",
  onDismissed,
  fallback = null,
  currentOrganizationId,
  origin = "web",
}: JoinOfferProps) {
  const host = useOrganizationHost();
  const offer = useJoinOffer({ currentOrganizationId: currentOrganizationId ?? null, origin });
  const { view, asking, dismissing, ask, dismiss, checkAgain } = offer;

  if (currentOrganizationId === undefined) return fallback;
  if (view === null) return null;

  if (view.kind === "invitation") {
    const { invitation } = view;
    const seat =
      orgRoleOptions.find((option) => option.value === invitation.role)?.label ?? invitation.role;
    return (
      <Takeover
        title={`You’re invited to join ${invitation.organizationName}`}
        intro={`An administrator has already invited you, with the ${seat} seat.`}
        testId="join-team-invitation"
      >
        <Button
          colorPalette="orange"
          width="full"
          minHeight="44px"
          loading={offer.accepting}
          onClick={() => offer.accept(invitation.inviteCode)}
        >
          Accept the invitation to {invitation.organizationName}
        </Button>
        <Button variant="outline" width="full" minHeight="44px" onClick={offer.setInvitationAside}>
          {dismissLabel}
        </Button>
      </Takeover>
    );
  }

  if (view.kind === "admitting") {
    return (
      <Takeover
        title={`Joining ${view.organizationName}`}
        intro="Your colleagues are already here, and this organization lets people on your domain straight in."
        testId="join-team-admitting"
      >
        <Text fontSize="13px" color="fg.muted" textAlign="center">
          One moment.
        </Text>
      </Takeover>
    );
  }

  if (view.kind === "waiting") {
    return (
      <Takeover title="Waiting for an administrator" testId="join-team-waiting">
        <Text fontSize="14px" lineHeight="1.65" color="fg.muted" textAlign="center">
          {view.organizationName === null
            ? "Your request to join is with the administrators."
            : `Your request to join ${view.organizationName} is with their administrators.`}{" "}
          We will email you as soon as somebody answers, either way.
        </Text>
        <Button colorPalette="orange" width="full" minHeight="44px" onClick={checkAgain}>
          Check again
        </Button>
        <Button variant="outline" width="full" minHeight="44px" onClick={() => host.signOut()}>
          Sign out
        </Button>
      </Takeover>
    );
  }

  if (view.kind === "nothing") return <>{fallback}</>;

  return (
    <Takeover
      title="Your colleagues are already here"
      intro="Join them instead of building in a workspace of your own."
      testId="join-team-takeover"
    >
      {view.organizations.map((organization) => (
        <Button
          key={organization.organizationId}
          colorPalette="orange"
          width="full"
          minHeight="44px"
          loading={asking}
          onClick={() => ask(organization.organizationId)}
        >
          Ask to join {organization.name}
        </Button>
      ))}
      <Button
        variant="outline"
        width="full"
        minHeight="44px"
        loading={dismissing}
        onClick={() => dismiss(onDismissed)}
      >
        {dismissLabel}
      </Button>
      <Text fontSize="12.5px" color="fg.subtle" textAlign="center">
        We will not ask about this domain again.
      </Text>
    </Takeover>
  );
}

/**
 * A cover that a backdrop click cannot dismiss: "not now" is right there, and a
 * stray click is not an answer — treating it as one asks them again tomorrow.
 */
function Takeover({
  title,
  intro,
  testId,
  children,
}: {
  title: string;
  intro?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open
      size="cover"
      placement="center"
      closeOnInteractOutside={false}
      closeOnEscape={false}
      onOpenChange={() => void 0}
    >
      <Dialog.Content data-testid={testId} bg="bg" borderRadius={0}>
        <Dialog.Body display="flex" alignItems="center" justifyContent="center" padding={6}>
          <VStack width="full" maxWidth="420px" align="stretch" gap="18px">
            <Box>
              <Dialog.Title
                fontSize="22px"
                fontWeight={600}
                letterSpacing="-0.01em"
                textAlign="center"
              >
                {title}
              </Dialog.Title>
              {intro !== undefined && (
                <Text fontSize="14px" color="fg.muted" textAlign="center" paddingTop="6px">
                  {intro}
                </Text>
              )}
            </Box>
            {children}
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export default JoinYourTeamTakeover;
