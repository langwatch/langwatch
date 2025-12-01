import { Alert, Button, VStack } from "@chakra-ui/react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { LoadingScreen } from "../../components/LoadingScreen";
import { SetupLayout } from "../../components/SetupLayout";
import { toaster } from "../../components/ui/toaster";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { api } from "../../utils/api";
import { captureException } from "~/utils/posthogErrorCapture";

export default function Accept() {
  const router = useRouter();
  const { inviteCode } = router.query;
  const acceptInviteMutation = api.organization.acceptInvite.useMutation();
  const queryClient = api.useContext();

  const { data: session } = useRequiredSession();
  const triggerInvite = typeof inviteCode === "string" && !!session;

  // Track the last attempted email to prevent duplicate attempts with same email
  // This ensures we don't retry if the invite was already accepted by this user
  const lastAttemptedEmailRef = useRef<string | null>(null);

  useEffect(() => {
    if (!triggerInvite || !session?.user?.email) return;

    const currentEmail = session.user.email;

    // Prevent multiple calls with the same email - only mutate if:
    // 1. Not already loading
    // 2. Not already successful
    // 3. Previous attempt was a wrong email error (allow retry after logout/login with correct email)
    // 4. Haven't already attempted with this email
    const isWrongEmailError =
      acceptInviteMutation.isError &&
      acceptInviteMutation.error.message.includes("but you are signed in as");

    // If we've already attempted with this email and it wasn't a wrong email error, don't retry
    // This prevents accepting with wrong email (backend also prevents this, but this is an extra safeguard)
    if (
      lastAttemptedEmailRef.current === currentEmail &&
      !isWrongEmailError &&
      (acceptInviteMutation.isSuccess || acceptInviteMutation.isError)
    ) {
      return;
    }

    if (
      acceptInviteMutation.isLoading ||
      acceptInviteMutation.isSuccess ||
      (acceptInviteMutation.isError && !isWrongEmailError)
    ) {
      return;
    }

    // Track that we're attempting with this email
    // Note: Backend enforces email match (see organization.ts:829) - invite can ONLY be accepted
    // if session.user.email === invite.email. This frontend check is just an extra safeguard.
    lastAttemptedEmailRef.current = currentEmail;

    acceptInviteMutation.mutate(
      { inviteCode },
      {
        onSuccess: (data) => {
          // Invalidate queries to refresh user's organization data
          void queryClient.organization.getAll.invalidate().catch((error) => {
            captureException(error, {
              tags: {
                inviteCode,
              },
            });
          });

          toaster.create({
            title: "Invite Accepted",
            description: `You have successfully accepted the invite for ${data.invite.organization.name}.`,
            type: "success",
            meta: {
              closable: true,
            },
            duration: 5000,
          });

          void router.push(`/${data.project?.slug ?? ""}`).catch((error) => {
            captureException(error, {
              tags: {
                inviteCode,
              },
            });
          });
        },
      },
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerInvite, session?.user?.email]);

  // Check if error is "already accepted" - if so, show redirect button instead of error
  const isAlreadyAccepted =
    acceptInviteMutation.isError &&
    acceptInviteMutation.error.message.includes("already accepted");

  if (
    !triggerInvite ||
    acceptInviteMutation.isLoading ||
    acceptInviteMutation.isSuccess
  ) {
    return <LoadingScreen />;
  }

  if (isAlreadyAccepted) {
    return (
      <SetupLayout>
        <VStack gap={4}>
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Invite Already Accepted</Alert.Title>
              <Alert.Description>
                This invite has already been accepted. You can now access the
                organization.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
          <Button
            colorPalette="blue"
            onClick={() => {
              void router.push("https://app.langwatch.ai");
            }}
          >
            Go to App
          </Button>
        </VStack>
      </SetupLayout>
    );
  }

  if (acceptInviteMutation.isError) {
    // Check if it's a wrong email error
    const isWrongEmail = acceptInviteMutation.error.message.includes(
      "but you are signed in as",
    );

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
          {isWrongEmail ? (
            <Button colorPalette="orange" onClick={() => void signOut()}>
              Log Out and Try Again
            </Button>
          ) : (
            <Button
              colorPalette="blue"
              onClick={() => {
                void router.push("https://app.langwatch.ai");
              }}
            >
              Go to App
            </Button>
          )}
        </VStack>
      </SetupLayout>
    );
  }

  return <SetupLayout />;
}
