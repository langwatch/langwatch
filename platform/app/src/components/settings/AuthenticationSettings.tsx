import { Heading, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { SingleSignOnCard } from "@ee/sso/components/settings/authentication/SingleSignOnCard";
import { SingleSignOnPreviewCard } from "@ee/sso/components/settings/authentication/SingleSignOnPreviewCard";
import { AvailabilityRefusalNotice } from "@ee/sso/components/settings/singleSignOn/refusals";
import { setupProgressFor } from "@ee/sso/logic/setupProgress";
import type { SelfServeGoLiveView } from "@ee/sso/sso-self-serve.types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { DirectoryCard } from "./authentication/DirectoryCard";
import { OrganizationPolicyCard } from "./authentication/OrganizationPolicyCard";

/** Uses the same readiness rules as the setup journey. */
function goLiveBlockedBecauseFor(
  goLive: SelfServeGoLiveView | null | undefined,
): string | null {
  return setupProgressFor({
    domainProved: goLive?.domainProved ?? false,
    testSignInDone: goLive?.testSignIn.done ?? false,
    breakGlassInPlace: goLive?.breakGlass.inPlace ?? false,
    arrivalsDecided: goLive?.arrivalsDecided ?? false,
    activated: goLive?.activated ?? false,
  }).goLiveBlockedBecause;
}

export function AuthenticationSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const canManage = hasPermission("sso:manage");
  const canReadMembership = hasPermission("organization:manage");

  const setup = api.ssoSetup.getSetup.useQuery({ organizationId });
  const data = setup.data;
  const connection = data?.connection ?? null;

  // Setting it up is not this organization's to do yet. The reason goes above
  // the cards rather than instead of them.
  const refusal =
    data !== undefined && !data.availability.available
      ? data.availability.refusal
      : null;

  const goLiveBlockedBecause = goLiveBlockedBecauseFor(data?.goLive);

  return (
    <VStack align="stretch" gap={4} width="full">
      <VStack align="stretch" gap={1}>
        <Heading size="sm">Sign-in and provisioning</Heading>
        <Text color="fg.muted" fontSize="sm">
          Connect your identity provider for single sign-on and directory sync.
        </Text>
      </VStack>
      {refusal && <AvailabilityRefusalNotice refusal={refusal} />}

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} width="full">
        {/* THE CARD IS THE SAME SHAPE WHETHER OR NOT THERE IS A CONNECTION.
            A half-built one is not a different subject from a live one, and
            an organization with none still needs to be told what one would
            do — so the preview card stands in rather than the region
            vanishing. Only its contents differ. */}
        {connection && connection.state === "ACTIVE" && data ? (
          <SingleSignOnCard
            setup={{ ...data, connection }}
            canManage={canManage}
          />
        ) : (
          <SingleSignOnPreviewCard
            state={connection?.state ?? null}
            canManage={canManage && refusal === null}
            goLiveBlockedBecause={goLiveBlockedBecause}
            // A connection registered to replace the one signing people in is
            // half-built by lifecycle and well under way by the reader's
            // reckoning, so the card says where the UPDATE got to rather than
            // where a new connection got to.
            updatePhase={data?.migration?.phase ?? null}
          />
        )}
        <DirectoryCard
          organizationId={organizationId}
          canReadMembership={canReadMembership}
        />
      </SimpleGrid>

      <VStack align="stretch" gap={4} paddingTop={2}>
        <VStack align="stretch" gap={1}>
          <Heading size="sm">Organization policies</Heading>
          <Text color="fg.muted" fontSize="sm">
            Manage who can join and how accounts stay secure. These policies
            also apply when your organization uses password sign-in.
          </Text>
        </VStack>
        <OrganizationPolicyCard
          organizationId={organizationId}
          canManage={canReadMembership}
          ssoLive={connection?.state === "ACTIVE"}
        />
      </VStack>
    </VStack>
  );
}
