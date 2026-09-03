/**
 * The subscription, at `/settings/subscription`.
 *
 * TWO PAGES BEHIND ONE ADDRESS, and the deployment decides which. On the hosted
 * product this is the real billing surface — seats, invoices, the Stripe
 * portal. On a self-hosted deployment there is no subscription to manage at
 * all, so the page says so and points at langwatch.ai rather than rendering a
 * billing form that could never charge anything.
 *
 * THE SPLIT IS READ AS A SETTLED PAIR. While the deployment answer is still
 * arriving neither branch is right, and rendering the self-hosted copy at a
 * paying customer for the length of a round trip is the worse of the two
 * mistakes, so the page waits.
 *
 * `SubscriptionPage` was a `next/dynamic` import with `ssr: false` on the
 * platform page. There is no server render here — the whole application is a
 * browser bundle behind a lazy route — so the dynamic wrapper had nothing left
 * to defer and the import is direct.
 */

import { Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useBillingHost } from "../../model/billing-host";
import { Link } from "../../ui/elements/link";
import { SubscriptionPage } from "./subscription-page";

/**
 * The grant this key carries.
 *
 * NONE, one for one with the platform page: `subscription.tsx` was wrapped in
 * no `withPermissionGuard` at all. Every procedure behind it states its own
 * policy, so a reader without the grant meets reads that refused rather than a
 * billing state they should not see. Carried rather than tidied, because
 * inventing a guard is a change to who can reach an address.
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
