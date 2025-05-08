import {
  Button,
  Card,
  Heading,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { signIn, useSession } from "next-auth/react";
import { api } from "../../utils/api";
import SettingsLayout from "../../components/SettingsLayout";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { titleCase } from "../../utils/stringCasing";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import { LuKeyRound, LuX } from "react-icons/lu";
import { toaster } from "../../components/ui/toaster";

const getProviderDisplayName = (
  provider: string,
  providerAccountId: string
) => {
  if (provider === "auth0") {
    // For other auth0 providers, the ID format is "provider|id"
    const [actualProvider] = providerAccountId.split("|");

    const providerMap: Record<string, string> = {
      auth0: "Email/Password",
      "google-oauth2": "Google",
      windowslive: "Microsoft",
      github: "GitHub",
    };

    return (
      (providerMap[actualProvider ?? ""] ??
        titleCase(actualProvider ?? "unknown")) + " (via auth0)"
    );
  }
  return titleCase(provider);
};

export default function AuthenticationSettings() {
  const { data: accounts, isLoading } = api.user.getLinkedAccounts.useQuery({});
  const unlinkAccount = api.user.unlinkAccount.useMutation();
  const { data: session } = useSession();
  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";
  const isAzureAD = publicEnv.data?.NEXTAUTH_PROVIDER === "azure-ad";
  const apiContext = api.useContext();

  if (!isAuth0 && !isAzureAD) {
    return null;
  }

  const handleLinkProvider = () => {
    if (isAuth0) {
      void signIn("auth0", {
        callbackUrl: window.location.href,
      });
    } else if (isAzureAD) {
      void signIn("azure-ad", {
        callbackUrl: window.location.href,
      });
    }
  };

  const handleUnlink = async (accountId: string) => {
    try {
      await unlinkAccount.mutateAsync({ accountId });
      await apiContext.user.getLinkedAccounts.invalidate();
      toaster.create({
        title: "Sign-in method removed",
        type: "success",
        placement: "top-end",
        meta: {
          closable: true,
        },
      });
    } catch (error) {
      toaster.create({
        title: "Failed to remove sign-in method",
        description:
          error instanceof Error ? error.message : "Please try again",
        type: "error",
        placement: "top-end",
        meta: {
          closable: true,
        },
      });
    }
  };

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <VStack align="start" gap={1}>
          <Heading size="lg" as="h1">
            Authentication Settings
          </Heading>
          <Text>({session?.user?.email})</Text>
        </VStack>

        <Card.Root width="full">
          <Card.Body width="full" paddingY={4}>
            <HorizontalFormControl
              label="Linked Sign-in Methods"
              helper={
                <Text>
                  You can link additional sign-in methods to your account.
                  <br />
                  All linked methods must use the same email address as your
                  main account.
                </Text>
              }
            >
              {isLoading ? (
                <Spinner />
              ) : (
                <VStack width="full" align="end" gap={4} marginTop={4}>
                  <VStack align="start" gap={1}>
                    {accounts?.map((account) => (
                      <HStack key={account.id} width="full">
                        <LuKeyRound />
                        <Text>
                          {getProviderDisplayName(
                            account.provider,
                            account.providerAccountId
                          )}
                        </Text>
                        <Spacer />
                        {accounts.length > 1 && (
                          <IconButton
                            aria-label="Remove sign-in method"
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleUnlink(account.id)}
                            disabled={unlinkAccount.isLoading}
                          >
                            <LuX />
                          </IconButton>
                        )}
                      </HStack>
                    ))}
                  </VStack>
                  <Button onClick={handleLinkProvider} colorPalette="orange">
                    Link New Sign-in Method
                  </Button>
                </VStack>
              )}
            </HorizontalFormControl>
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}
