import { Alert, Button, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { signOut } from "~/utils/auth-client";
import { useEffect } from "react";
import { LoadingScreen } from "../../components/LoadingScreen";
import { SetupLayout } from "../../components/SetupLayout";
import { toaster } from "../../components/ui/toaster";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { api } from "../../utils/api";

export default function Accept() {
  const router = useRouter();
  const { inviteCode } = router.query;
  const acceptInviteMutation = api.organization.acceptInvite.useMutation();

  const { data: session } = useRequiredSession();
  const triggerInvite = typeof inviteCode === "string" && !!session;

  useEffect(() => {
    if (!triggerInvite) return;

    acceptInviteMutation.mutate(
      { inviteCode },
      {
        onSuccess: (data) => {
          toaster.create({
            title: "Invite Accepted",
            description: `You have successfully accepted the invite for ${data.invite.organization.name}.`,
            type: "success",
            meta: {
              closable: true,
            },
            duration: 5000,
          });

          // Hard redirect so the page reloads with a clean cache — avoids
          // useOrganizationTeamProject reading stale (no-org) data and
          // bouncing the user to /onboarding/welcome
          window.location.href = data.project?.slug
            ? `/${data.project.slug}`
            : "/";
        },
      },
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerInvite]);

  if (
    !triggerInvite ||
    acceptInviteMutation.isLoading ||
    acceptInviteMutation.isSuccess
  ) {
    return <LoadingScreen />;
  }

  if (acceptInviteMutation.isError) {
    if (acceptInviteMutation.error.message === "Invite was already accepted") {
      void router.push("/");
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
              <Alert.Description>
                {acceptInviteMutation.error.message}
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Button colorPalette="orange" onClick={() => void signOut()}>
            Log Out and Try Again
          </Button>
        </VStack>
      </SetupLayout>
    );
  }

  return <SetupLayout />;
}
