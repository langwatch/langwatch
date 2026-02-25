import { Heading, HStack, Text, VStack } from "@chakra-ui/react";
import dynamic from "next/dynamic";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";

const SubscriptionPage = dynamic(
  () =>
    import("~/components/subscription/SubscriptionPage").then(
      (mod) => mod.SubscriptionPage
    ),
  { ssr: false }
);

export default function Subscription() {
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

  if (isSaaS) {
    return <SubscriptionPage />;
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
