/**
 * Subscription at /settings/subscription; two pages one address, deployment
 * picks. Waits for deployment answer before rendering.
 */

import { Skeleton, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { PageLayout } from "@langwatch/design-system/page-layout";

import { useBillingHost } from "../../model/billing-host.ts";
import { SubscriptionPage } from "./subscription-page.tsx";

export default function SubscriptionScreen() {
  const host = useBillingHost();

  if (!host.isDeploymentSettled()) return <Skeleton width="full" height="200px" />;
  if (host.isSaaS()) return <SubscriptionPage />;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Change Subscription</PageLayout.Heading>
      </PageLayout.Header>
      <VStack width="full" gap={4} align="start" paddingTop={4}>
        <Text>
          This is the self-hosted version of LangWatch and all the costs and maintenance are managed
          by yourself. If you want to use the cloud version, please visit{" "}
          <Link href="https://langwatch.ai" isExternal>
            langwatch.ai
          </Link>
        </Text>
      </VStack>
    </>
  );
}
