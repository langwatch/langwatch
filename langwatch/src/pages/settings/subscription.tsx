import { Heading, HStack, Text, VStack } from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { dependencies } from "../../injection/dependencies.client";

export default function Subscription() {
  if (dependencies.SubscriptionPage) {
    return <dependencies.SubscriptionPage />;
  }

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
          <Heading as="h2">Change Subscription</Heading>
        </HStack>
        <VStack width="full" gap={4} align="start">
          <Text>
            This is the self-hosted version of LangWatch and all the costs and
            maintenance are managed by yourself. If you want to use the cloud
            version, please visit{" "}
            <Link href="https://langwatch.ai" isExternal>
              langwatch.ai
            </Link>
          </Text>
        </VStack>
      </VStack>
    </SettingsLayout>
  );
}
