import { Button, HStack, Text, VStack } from "@chakra-ui/react";

import { AuthCard } from "~/components/auth/AuthCard";
import {
  AuthShell,
  InviteLanding,
  useIdentityAuthScreens,
} from "~/features/auth";
import { usePublishAuthStage } from "~/features/auth/logic/groundStage";
import { HandledErrorAlert } from "~/features/errors";
import { signOut } from "~/utils/auth-client";
import { useRouter } from "~/utils/compat/next-router";
import { hardRedirect } from "~/utils/hardRedirect";
import { LoadingScreen } from "../../components/LoadingScreen";
import { SetupLayout } from "../../components/SetupLayout";
import { useAcceptInviteOnce } from "../../hooks/useAcceptInviteOnce";
import { useRequiredSession } from "../../hooks/useRequiredSession";

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
  const auth = useIdentityAuthScreens();
  const inviteCode = router.query.inviteCode;

  if (!auth.isResolved) return <LoadingScreen />;

  if (auth.enabled) {
    // The auth screens's ground under the auth screens' card, the way every other
    // enforced screen composes it. The landing was rendering its card on blank
    // paper, which made an invitation the one arrival that did not look like
    // the sign-in it leads to.
    return (
      <AuthShell>
        {typeof inviteCode === "string" && inviteCode.length > 0 ? (
          <InviteLanding inviteCode={inviteCode} />
        ) : (
          <IncompleteInviteLink />
        )}
      </AuthShell>
    );
  }

  return <LegacyAccept />;
}

/**
 * The link arrived with no code in it — cut in half by a mail client, or
 * typed short. It names no organization because there is none to name: nothing
 * was looked up, so nothing was found, and a dead end that describes what it
 * did not find is a way to learn which organizations exist.
 */
function IncompleteInviteLink() {
  usePublishAuthStage({ door: "signin", depth: "entry" });

  return (
    <AuthCard
      title="This invitation link is incomplete"
      intro="Some email clients cut long links in half. Open the one in your inbox again, or ask whoever invited you for a fresh link."
    >
      <Text
        fontSize="13.5px"
        lineHeight="1.65"
        color="fg.muted"
        data-testid="invite-incomplete"
      >
        Nothing has been accepted, and nothing expires while you sort it out.
      </Text>
    </AuthCard>
  );
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
