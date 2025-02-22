import { Link } from "../../components/ui/link";
import {
  Card,
  CardBody,
  HStack,
  Heading,
  Text,
  VStack,
} from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { dependencies } from "../../injection/dependencies.client";

export default function Subscription() {
  if (dependencies.SubscriptionPage) {
    return <dependencies.SubscriptionPage />;
  }

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Change Subscription
          </Heading>
        </HStack>
        <Card width="full">
          <CardBody width="full">
            <VStack
              width="full"
              spacing={4}
              paddingY={4}
              paddingX={4}
              align="start"
            >
              <Text>
                This is the self-hosted open-source version of LangWatch and all
                the costs and maintenance are managed by yourself. If you want
                to use the cloud version, please visit{" "}
                <Link href="https://langwatch.ai" textDecoration="underline">
                  langwatch.ai
                </Link>
              </Text>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
