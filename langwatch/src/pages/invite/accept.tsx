import { Alert, Button, VStack } from "@chakra-ui/react";
import { useRouter } from "~/utils/compat/next-router";
import { signOut } from "~/utils/auth-client";
import { useEffect, useRef } from "react";
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
  // One-shot guard: ensure `mutate` fires at most once per invite code, even
  // under StrictMode double-invoke, HMR, or parent re-keying.
  const submittedInviteCodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!triggerInvite) return;
    if (submittedInviteCodeRef.current === inviteCode) return;
    submittedInviteCodeRef.current = inviteCode;

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
        onError: (error) => {
          // Already-accepted is not an error from the user's perspective —
          // hard-redirect home, consistent with the success path.
          if (error.message === "Invite was already accepted") {
            window.location.href = "/";
          }
        },
      },
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerInvite, inviteCode]);

  if (
    !triggerInvite ||
    acceptInviteMutation.isLoading ||
    acceptInviteMutation.isSuccess ||
    (acceptInviteMutation.isError &&
      acceptInviteMutation.error.message === "Invite was already accepted")
  ) {
    return <LoadingScreen />;
  }

  if (acceptInviteMutation.isError) {
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
