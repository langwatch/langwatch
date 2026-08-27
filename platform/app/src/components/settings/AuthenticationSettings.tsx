import { SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { DirectoryCard } from "./authentication/DirectoryCard";
import { OrganizationPolicyCard } from "./authentication/OrganizationPolicyCard";
import { SingleSignOnCard } from "./authentication/SingleSignOnCard";
import { SingleSignOnPreviewCard } from "./authentication/SingleSignOnPreviewCard";
import { AvailabilityRefusalNotice } from "./singleSignOn/refusals";

/**
 * How everyone in the organization signs in, and how their accounts arrive —
 * the overview of it (ADR-124, wave 3).
 *
 * IT ONLY READS NOW. This page used to be two screens sharing one address: a
 * live connection's overview, and the five-step journey that sets one up,
 * with a control that swapped between them. Pressing "manage" took away the
 * cards you were reading from, and there was no way to be looking at both.
 * The journey is its own route, the provisioning detail is another, and the
 * rail beside this says so. Each card here carries the way into its own page.
 *
 * THREE THINGS, IN THE ORDER SOMEBODY ASKS THEM. Who signs people in, how
 * accounts arrive, and what this organization asks of everybody once they are
 * here. The first two are a glance each; the third is the pair of rules that
 * used to live on a page called Access — a word that described every page in
 * this cluster and therefore none of them.
 *
 * A REFUSAL IS NOT A SCREEN. An organization that cannot set single sign-on
 * up yet still reads this page: the cards say what a connection would give
 * them and what their directory is doing today, and the reason they cannot
 * start sits above as a banner naming the one thing that would change it.
 * Answering somebody's navigation click with nothing but "you can't use this"
 * teaches them neither what the feature is nor what their organization does.
 *
 * WHAT IS NOT HERE. Requiring single sign-on of everybody, a password
 * fallback, and browser session lifetimes are all things this organization
 * cannot actually set, so the page says nothing about them. A frame drawn
 * around a setting that does not exist is a promise the product has not made.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
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

  return (
    <VStack align="stretch" gap={4} width="full">
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
          />
        )}
        <DirectoryCard
          organizationId={organizationId}
          canReadMembership={canReadMembership}
        />
      </SimpleGrid>

      <OrganizationPolicyCard
        organizationId={organizationId}
        canManage={canReadMembership}
        ssoLive={connection?.state === "ACTIVE"}
      />

      <PersonalMethodsFooter />
    </VStack>
  );
}

/**
 * Where the reader's OWN way in lives, said on the page about everybody
 * else's.
 *
 * The two are next to each other in the menu and one letter apart in the
 * reader's head, so the organization's page ends by pointing at the personal
 * one rather than leaving somebody hunting for their passkeys under a heading
 * about identity providers.
 */
function PersonalMethodsFooter() {
  return (
    <Text fontSize="sm" color="fg.muted">
      Looking for your own passkeys and linked accounts? Those are personal and
      live on <Link href="/settings/profile">your profile</Link>.
    </Text>
  );
}
