import { Button, HStack, VStack } from "@chakra-ui/react";

import { HandledErrorAlert } from "~/features/errors";
import { signOut } from "~/utils/auth-client";
import { useRouter } from "~/utils/compat/next-router";
import { hardRedirect } from "~/utils/hardRedirect";
import { LoadingScreen } from "../../components/LoadingScreen";
import { SetupLayout } from "../../components/SetupLayout";
import { useAcceptInviteOnce } from "../../hooks/useAcceptInviteOnce";
import { useRequiredSession } from "../../hooks/useRequiredSession";

export default function Accept() {
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
