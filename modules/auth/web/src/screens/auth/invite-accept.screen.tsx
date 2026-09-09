import { Button, HStack, Text, VStack } from "@chakra-ui/react";

import { InviteLanding } from "../../ui/sections/invite-landing.tsx";
import { useIdentityFrontDoor } from "../../behavior/use-identity-front-door.ts";
import { HandledErrorAlert } from "../../ui/elements/handled-error-alert.tsx";
import { signOut } from "../../behavior/auth-client.tsx";
import { useRouter } from "../../behavior/use-route.ts";
import { hardRedirect } from "../../behavior/hard-redirect.ts";
import { LoadingScreen } from "../../ui/sections/loading-screen.tsx";
import { SetupLayout } from "../../ui/sections/setup-layout.tsx";
import { useAcceptInviteOnce } from "../../behavior/use-accept-invite-once.ts";
import { useRequiredSession } from "../../behavior/use-required-session.ts";

/**
 * The invitation link's landing (ADR-117 §6, D13).
 *
 * Enforced, it is a screen: it says who is asking before anything happens,
 * takes a signed-out visitor through sign-in or sign-up with the invitation
 * still in hand, and asks a signed-in one to confirm. Until the flip it stays
 * what it was — a page that accepts on arrival and requires a session to
 * reach at all.
 */
export default function Accept() {
  const router = useRouter();
  const frontDoor = useIdentityFrontDoor();
  const inviteCode = router.query.inviteCode;

  if (!frontDoor.isResolved) return <LoadingScreen />;

  if (frontDoor.enabled) {
    return typeof inviteCode === "string" && inviteCode.length > 0 ? (
      <InviteLanding inviteCode={inviteCode} />
    ) : (
      <SetupLayout>
        <Text>This invitation link is incomplete. Ask for a new one.</Text>
      </SetupLayout>
    );
  }

  return <LegacyAccept />;
}

function LegacyAccept() {
  const router = useRouter();
  const { inviteCode } = router.query;
  const { data: session } = useRequiredSession();
  const { status, error } = useAcceptInviteOnce({
    inviteCode: typeof inviteCode === "string" ? inviteCode : undefined,
    enabled: !!session,
  });

  // "already-accepted" and "success" both trigger a hard redirect in the hook;
  // show the loading screen while navigation is in flight so the error UI
  // never flashes for the benign already-accepted case.
  const isAwaitingOrRedirecting =
    status === "idle" ||
    status === "loading" ||
    status === "success" ||
    status === "already-accepted";

  if (isAwaitingOrRedirecting) {
    return <LoadingScreen />;
  }

  return (
    <SetupLayout>
      <VStack gap={4}>
        {/* A signed-out visitor with a dead invite link has no other recourse,
            so this has to say something they can act on. The registry supplies
            the words; the raw message would be the code slug (#5984). */}
        <HandledErrorAlert
          error={error}
          fallbackTitle="An error occurred while accepting the invite"
        />
        <HStack gap={3}>
          {/* Hard navigation on purpose: busts caches primed with pre-invite
              "no org" state, same reason the hook redirects hard on success. */}
          <Button colorPalette="orange" onClick={() => hardRedirect("/")}>
            Go to Dashboard
          </Button>
          <Button variant="outline" onClick={() => void signOut()}>
            Log Out and Try Again
          </Button>
        </HStack>
      </VStack>
    </SetupLayout>
  );
}
