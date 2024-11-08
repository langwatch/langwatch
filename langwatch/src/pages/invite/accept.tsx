import { useRouter } from "next/router";
import { LoadingScreen } from "../../components/LoadingScreen";
import { SetupLayout } from "../../components/SetupLayout";
import { useRequiredSession } from "../../hooks/useRequiredSession";
import { useEffect } from "react";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Button,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { api } from "../../utils/api";
import { signOut } from "next-auth/react";

export default function Accept() {
  const router = useRouter();
  const toast = useToast();
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
          toast({
            title: "Invite Accepted",
            description: `You have successfully accepted the invite for ${data.invite.organization.name}.`,
            status: "success",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
          void router.push(`/${data.project?.slug ?? ""}`);
        },
      }
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
    return (
      <SetupLayout>
        <VStack spacing={4}>
          <Alert status="error">
            <AlertIcon />
            <Box>
              <AlertTitle>
                An error occurred while accepting the invite.
              </AlertTitle>
              <AlertDescription>
                {acceptInviteMutation.error.message}
              </AlertDescription>
            </Box>
          </Alert>
          <Button colorScheme="orange" onClick={() => void signOut()}>
            Log Out and Try Again
          </Button>
        </VStack>
      </SetupLayout>
    );
  }

  return <SetupLayout />;
}
