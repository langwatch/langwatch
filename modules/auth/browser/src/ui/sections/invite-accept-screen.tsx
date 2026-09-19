import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { LoadingScreen } from "@langwatch/design-system/loading-screen";

import { signOut } from "../../behavior/auth-client.tsx";
import { hardRedirect } from "../../behavior/hard-redirect.ts";
import { useAcceptInviteOnce } from "../../behavior/use-accept-invite-once.ts";
import { useIdentityFrontDoor } from "../../behavior/use-identity-front-door.ts";
import { useRequiredSession } from "../../behavior/use-required-session.ts";
import { useRouter } from "../../behavior/use-route.ts";
import { HandledErrorAlert } from "../../ui/elements/handled-error-alert.tsx";
import { InviteLanding } from "../../ui/sections/invite-landing.tsx";
import { SetupLayout } from "../../ui/sections/setup-layout.tsx";

/** Invitation link landing; shows inviter, guides sign-in/up or confirms sign-in. */
export default function Accept() {
  const router = useRouter();
  const frontDoor = useIdentityFrontDoor();
  const inviteCode = router.query.inviteCode;

  if (!frontDoor.isResolved) return <LoadingScreen />;

  if (frontDoor.enabled) {
    return typeof inviteCode === "string" && inviteCode.length > 0 ? (
      <InviteLanding inviteCode={inviteCode} />
    ) : (
      <IncompleteInviteLink />
    );
  }

  return <LegacyAccept />;
}

/**
 * Email clients cut long links in half, so a code-less arrival is ordinary
 * rather than exceptional — and it has no acceptance to wait on.
 */
function IncompleteInviteLink() {
  return (
    <SetupLayout>
      <Text>This invitation link is incomplete. Ask for a new one.</Text>
    </SetupLayout>
  );
}

function LegacyAccept() {
  const router = useRouter();
  const { inviteCode } = router.query;
  const code = typeof inviteCode === "string" && inviteCode.length > 0 ? inviteCode : void 0;
  const { data: session } = useRequiredSession();
  const { status, error } = useAcceptInviteOnce({
    inviteCode: code,
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

  // Without a code there is nothing to accept, so `idle` is where the hook
  // stays — and the reader waited on a spinner that could never resolve.
  if (code === void 0) return <IncompleteInviteLink />;

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
