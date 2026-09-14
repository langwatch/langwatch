/**
 * Subscription at /settings/subscription; two pages one address, deployment
 * picks. Waits for deployment answer before rendering.
 */

import { Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useBillingHost } from "../../model/billing-host.ts";
import { Link } from "../../ui/elements/link.tsx";
import { SubscriptionPage } from "./subscription-page.tsx";

/**
 * No permission guard: the page carries NONE. Each procedure states its own policy,
 * and every read that should be hidden is already refused there.
 */
export const SUBSCRIPTION_PAGE_PERMISSION = void 0;

export default function SubscriptionScreen() {
  const host = useBillingHost();

  if (!host.isDeploymentSettled()) return <Spinner />;
  if (host.isSaaS()) return <SubscriptionPage />;

  return (
    <VStack gap={6} width="full" align="start">
      <HStack width="full" marginTop={2}>
        <Heading as="h2">Change Subscription</Heading>
      </HStack>
      <VStack width="full" gap={4} align="start">
        <Text>
          This is the self-hosted version of LangWatch and all the costs and maintenance are managed
          by yourself. If you want to use the cloud version, please visit{" "}
          <Link href="https://langwatch.ai" isExternal>
            langwatch.ai
          </Link>
        </Text>
      </VStack>
    </VStack>
  );
}
