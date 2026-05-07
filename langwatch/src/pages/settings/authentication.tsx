import {
  Alert,
  Heading,
  Link as ChakraLink,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Link } from "~/components/ui/link";

import SettingsLayout from "../../components/SettingsLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";

function AuthenticationSettings() {
  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <VStack align="start" gap={1}>
          <Heading as="h2">SSO Provider Setup</Heading>
          <Text color="fg.muted">
            Configure org-wide single sign-on for your members.
          </Text>
        </VStack>

        <Alert.Root status="info" variant="surface">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>SSO setup is admin-only and lives here.</Alert.Title>
            <Alert.Description>
              <Text marginBottom={2}>
                Looking for your personal sign-in methods (change password,
                link Google/GitHub, etc.)?{" "}
                <ChakraLink asChild color="orange.600">
                  <Link href="/me/sign-in-methods">Go to Sign-in Methods</Link>
                </ChakraLink>
                .
              </Text>
              <Text>
                Org-wide SSO provisioning UI is on the governance roadmap.
                Today, SSO is configured via environment variables / IdP
                metadata; talk to support if you need to enable it.
              </Text>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:manage", {
  layoutComponent: SettingsLayout,
})(AuthenticationSettings);
