/**
 * Subscription at /settings/subscription; two pages one address, deployment
 * picks. Waits for deployment answer before rendering.
 */

import { Skeleton, Text, VStack } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Server } from "lucide-react";

import { useBillingHost } from "../../model/billing-host.ts";
import { SubscriptionPage } from "./subscription-page.tsx";

export default function SubscriptionScreen() {
  const host = useBillingHost();

  if (!host.isDeploymentSettled()) return <Skeleton width="full" height="200px" />;
  if (host.isSaaS()) return <SubscriptionPage />;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Subscription</PageLayout.Heading>
      </PageLayout.Header>
      <VStack width="full" gap={6} align="start" paddingTop={4}>
        <Text color="fg.muted">What running LangWatch yourself means for billing.</Text>
        <NoDataInfoBlock
          icon={<Server />}
          title="You run this LangWatch yourself"
          description="This is the self-hosted version of LangWatch and all the costs and maintenance are managed by yourself. If you want to use the cloud version, please visit"
        >
          <Link href="https://langwatch.ai" isExternal color="orange.fg">
            langwatch.ai
          </Link>
        </NoDataInfoBlock>
      </VStack>
    </>
  );
}
