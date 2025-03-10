import {
  Button,
  Card,
  Heading,
  HStack,
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
import { LuKeyRound } from "react-icons/lu";

const getProviderDisplayName = (
  provider: string,
  providerAccountId: string
) => {
  if (provider === "auth0") {
    // For other auth0 providers, the ID format is "provider|id"
    const [actualProvider] = providerAccountId.split("|");
    // If it's an auth0 internal account (email/password)
    if (providerAccountId.startsWith("auth0|")) {
      return "Email/Password (via auth0)";
    }
    return titleCase(actualProvider ?? "") + " (via auth0)";
  }
  return titleCase(provider);
};

export default function AuthenticationSettings() {
  const { data: accounts, isLoading } = api.user.getLinkedAccounts.useQuery({});
  const { data: session } = useSession();
  const publicEnv = usePublicEnv();
  const isAuth0 = publicEnv.data?.NEXTAUTH_PROVIDER === "auth0";

  if (!isAuth0) {
    return null;
  }

  const handleLinkProvider = () => {
    void signIn("auth0", {
      callbackUrl: window.location.href,
    });
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
                  You can link additional sign-in methods to your account.<br />
                  All linked methods must use the same email address as your main account.
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
