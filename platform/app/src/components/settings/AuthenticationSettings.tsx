import { Button, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft, Settings2 } from "lucide-react";
import { useSearchParams } from "react-router";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { DirectoryCard } from "./authentication/DirectoryCard";
import { SingleSignOnCard } from "./authentication/SingleSignOnCard";
import { SingleSignOnPreviewCard } from "./authentication/SingleSignOnPreviewCard";
import { SingleSignOnSetup } from "./SingleSignOnSetup";
import { AvailabilityRefusalNotice } from "./singleSignOn/refusals";

/** The address that opens the journey on a connection already live. */
const MANAGE_PARAM = "manage";
const MANAGE_CONNECTION = "connection";

/**
 * How everyone in the organization signs in, and how their accounts arrive
 * (ADR-124, wave 3).
 *
 * ONE PAGE, TWO MODES, AND THE MODE IS THE CONNECTION'S RATHER THAN A
 * SETTING. Before a connection is live there is nothing to overview: what an
 * administrator needs is the journey, five steps in the order the work
 * happens in, and that is the whole page. Once it is live the journey has
 * done its job and the question changes from "how do I set this up" to "is it
 * working", which is two cards and a glance. Nothing is switched on or off to
 * move between them — the connection's own state says which question the
 * reader is asking.
 *
 * MANAGING IS STILL ONE PAGE. The journey does not go away when the
 * connection goes live: domains are claimed later, break-glass grants expire,
 * a test sign-in is worth running again. It moves BEHIND the overview, one
 * quiet control away, and the address carries which one you are looking at so
 * a link to it opens where it was sent from.
 *
 * A REFUSAL IS NOT A SCREEN. An organization that cannot set single sign-on
 * up yet still reads the page: the cards say what a connection would give
 * them and what their directory is doing today, and the reason they cannot
 * start sits above as a banner naming the one thing that would change it.
 * Answering somebody's navigation click with nothing but "you can't use this"
 * teaches them neither what the feature is nor what their organization does.
 *
 * WHAT IS NOT HERE. Requiring single sign-on of everybody, a password
 * fallback, and session lifetimes are all things this organization cannot
 * actually set, so the page says nothing about them. A frame drawn around a
 * setting that does not exist is a promise the product has not made.
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

  const [searchParams, setSearchParams] = useSearchParams();
  const setup = api.ssoSetup.getSetup.useQuery({ organizationId });

  const showManage = (open: boolean) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (open) params.set(MANAGE_PARAM, MANAGE_CONNECTION);
        else params.delete(MANAGE_PARAM);
        return params;
      },
      { replace: true },
    );

  const data = setup.data;
  const connection = data?.connection ?? null;

  // Setting it up is not this organization's to do yet. The reason goes above
  // the cards rather than instead of them.
  if (data !== undefined && !data.availability.available) {
    return (
      <VStack align="stretch" gap={4} width="full">
        <AvailabilityRefusalNotice refusal={data.availability.refusal} />
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} width="full">
          <SingleSignOnPreviewCard />
          <DirectoryCard
            organizationId={organizationId}
            canReadMembership={canReadMembership}
          />
        </SimpleGrid>
        <PersonalMethodsFooter />
      </VStack>
    );
  }

  // The overview is for a connection that is actually on. Everything else —
  // still loading, half-built, suspended — is the journey, which already says
  // all of those things in its own words.
  if (
    data === undefined ||
    connection === null ||
    connection.state !== "ACTIVE"
  ) {
    return <SingleSignOnSetup organizationId={organizationId} />;
  }

  if (searchParams.get(MANAGE_PARAM) === MANAGE_CONNECTION) {
    return (
      <VStack align="stretch" gap={4} width="full">
        <Button
          alignSelf="start"
          size="sm"
          variant="ghost"
          onClick={() => showManage(false)}
        >
          <ArrowLeft size={14} />
          Back to the overview
        </Button>
        <SingleSignOnSetup organizationId={organizationId} />
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={4} width="full">
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4} width="full">
        <SingleSignOnCard
          setup={{ ...data, connection }}
          canManage={canManage}
        />
        <DirectoryCard
          organizationId={organizationId}
          canReadMembership={canReadMembership}
        />
      </SimpleGrid>

      {/* THE WAY TO CHANGE OR END IT, NAMED. "Manage connection" is a door
          with nothing written on it: an administrator who came to turn their
          identity provider off, re-check a domain, or hand over new
          credentials had no way of knowing any of that was behind it, and a
          control nobody can predict the contents of is one nobody presses. */}
      <VStack align="start" gap={0} width="full">
        <Button size="sm" variant="ghost" onClick={() => showManage(true)}>
          <Settings2 size={14} />
          Manage or turn off this connection
        </Button>
        <Text fontSize="xs" color="fg.muted" paddingLeft={3}>
          Claim another domain, test the sign-in again, name a way back in, or
          remove the connection.
        </Text>
      </VStack>

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
