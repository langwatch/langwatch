import { Alert, Button, HStack, VStack } from "@chakra-ui/react";

import { LoadingScreen } from "../../components/LoadingScreen";
import { SetupLayout } from "../../components/SetupLayout";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { useAcceptInviteOnce } from "../../hooks/useAcceptInviteOnce";
import { useRouter } from "~/utils/compat/next-router";
import { signOut } from "~/utils/auth-client";
import { hardRedirect } from "~/utils/hardRedirect";

export default function Accept() {
  const router = useRouter();
  const { inviteCode } = router.query;
  const { data: session } = useRequiredSession();
  const { status, errorMessage } = useAcceptInviteOnce({
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
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              An error occurred while accepting the invite.
            </Alert.Title>
            <Alert.Description>{errorMessage}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
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
