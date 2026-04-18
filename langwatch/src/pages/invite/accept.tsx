import { Alert, Button, VStack } from "@chakra-ui/react";

import { LoadingScreen } from "../../components/LoadingScreen";
import { SetupLayout } from "../../components/SetupLayout";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { useAcceptInviteOnce } from "../../hooks/useAcceptInviteOnce";
import { useRouter } from "~/utils/compat/next-router";
import { signOut } from "~/utils/auth-client";

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
        <Button colorPalette="orange" onClick={() => void signOut()}>
          Log Out and Try Again
        </Button>
      </VStack>
    </SetupLayout>
  );
}
