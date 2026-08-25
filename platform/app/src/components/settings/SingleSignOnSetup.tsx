import {
  Alert,
  Box,
  Card,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type {
  SelfServeGoLiveView,
  SelfServeSetupView,
} from "@langwatch/identity-server";
import {
  connectionProtocolName,
  connectionStatusChipFor,
} from "~/features/sso/logic/connectionStatus";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { IdentityChip } from "../access/IdentityRow";
import { BreakGlassSection } from "./singleSignOn/BreakGlassSection";
import { DomainsSection } from "./singleSignOn/DomainsSection";
import { GoLiveSection } from "./singleSignOn/GoLiveSection";
import { RegisterConnection } from "./singleSignOn/RegisterConnection";
import {
  AvailabilityRefusalNotice,
  LoadFailure,
} from "./singleSignOn/refusals";
import { ServiceProviderDetails } from "./singleSignOn/ServiceProviderDetails";
import { SetupStep } from "./singleSignOn/SetupStep";
import { TestSignInSection } from "./singleSignOn/TestSignInSection";

/**
 * Setting enterprise single sign-on up yourself, all the way to live (D05
 * tiers 2 and 3, D09, wave 3 — see specs/identity/sso-onboarding-tiers.feature,
 * specs/identity/sso-idp-termination.feature and
 * specs/identity/sso-activation.feature).
 *
 * ONE SCREEN, FIVE STEPS, in the order the work happens in: tell us about the
 * identity provider, prove a domain is yours, sign in through it once, name
 * somebody who can still get in without it, turn it on. The connection's own
 * state machine says which step an organization is on, so this screen
 * remembers nothing — reload it halfway through and it resumes exactly where
 * the aggregate says the customer is.
 *
 * One screen for both tiers, because they are one journey with two answers
 * to one question: what authorizes this domain. A licensed self-hosted
 * installation's licence answers it in the same step as the claim, so there
 * is no record and nothing to wait for; a hosted organization's claim is
 * decided by the record they publish. The screen reads the answer off the
 * setup rather than branching on a deployment of its own.
 *
 * Two permissions, and the split is visible rather than cosmetic: with
 * `sso:view` the connection, its domains, its state and the ways back in are
 * readable, and NO control the reader cannot use is rendered at all. A
 * disabled button is still an invitation, and inviting somebody to do a thing
 * they will be refused for is worse than not offering it.
 *
 * Two things are nowhere on this screen and cannot be. Vouching for a domain
 * is a LangWatch operator's act on every tier, so the surface offers
 * publishing a record and nothing else. Suspending a live connection is an
 * operator's too — putting it here would put the lever for a failing identity
 * provider behind that identity provider.
 */

export function SingleSignOnSetup({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });
  const canManage = hasPermission("sso:manage");
  const setup = api.ssoSetup.getSetup.useQuery({ organizationId });

  if (setup.isLoading) return <Text>Loading…</Text>;
  // A read that failed says so, in the words registered for its code. It must
  // never fall through to the empty state below: "nothing is registered yet"
  // and "we could not find out" are different facts, and only one of them
  // means start typing.
  if (setup.error) {
    return <LoadFailure error={setup.error} what="single sign-on setup" />;
  }
  if (!setup.data) return <Text>Single sign-on setup is unavailable.</Text>;

  const { availability, connection, claims, record, serviceProvider, goLive } =
    setup.data as SelfServeSetupView;

  // The refusal itself is the Authentication page's to place, above the
  // cards that explain what single sign-on would give this organization. A
  // journey that cannot be started is not a screen.
  if (!availability.available) {
    return <AvailabilityRefusalNotice refusal={availability.refusal} />;
  }

  if (connection === null) {
    return (
      <VStack align="stretch" gap={6} width="full">
        <SetupStep number={1} title="Connect your identity provider">
          {canManage ? (
            <RegisterConnection
              organizationId={organizationId}
              serviceProvider={serviceProvider}
            />
          ) : (
            <Text color="fg.muted">
              No identity provider is registered for this organization yet.
            </Text>
          )}
        </SetupStep>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={6} width="full">
      <ConnectionSummary connection={connection} goLive={goLive} />

      <SetupStep number={1} title="Your identity provider" done>
        <ServiceProviderDetails
          serviceProvider={serviceProvider}
          connected
          protocol={connection.type}
        />
      </SetupStep>

      <SetupStep
        number={2}
        title="Prove a domain is yours"
        done={goLive?.domainProved ?? false}
      >
        <DomainsSection
          claims={claims}
          connection={connection}
          record={record}
          canManage={canManage}
          organizationId={organizationId}
          connectionId={connection.connectionId}
          provesWithLicense={availability.proof === "license-token"}
        />
      </SetupStep>

      <SetupStep
        number={3}
        title="Sign in through it once"
        done={goLive?.testSignIn.done ?? false}
      >
        <TestSignInSection
          connectionId={connection.connectionId}
          providerName={connection.providerId}
          canManage={canManage}
          testSignIn={goLive?.testSignIn ?? { done: false, atMs: null }}
        />
      </SetupStep>

      <SetupStep
        number={4}
        title="Name someone who can still get in"
        done={goLive?.breakGlass.inPlace ?? false}
      >
        <BreakGlassSection
          organizationId={organizationId}
          canManage={canManage}
        />
      </SetupStep>

      <SetupStep
        number={5}
        title="Turn it on"
        done={goLive?.activated ?? false}
      >
        <GoLiveSection
          organizationId={organizationId}
          connectionId={connection.connectionId}
          canManage={canManage}
          goLive={goLive}
        />
      </SetupStep>
    </VStack>
  );
}

/**
 * Where the connection stands, and — separately — whether anybody is actually
 * being sent to it.
 *
 * The two are different facts and the banner says both. An ACTIVE connection
 * whose organization has not been switched over routes nothing yet, and a
 * screen that said "live" would be telling somebody their rollout finished at
 * the exact moment they were about to test it.
 */
function ConnectionSummary({
  connection,
  goLive,
}: {
  connection: NonNullable<SelfServeSetupView["connection"]>;
  goLive: SelfServeGoLiveView | null;
}) {
  const chip = connectionStatusChipFor({
    state: connection.state,
    routingSwitchedOn: goLive?.routingSwitchedOn ?? false,
  });
  return (
    <Card.Root borderRadius="xl">
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <HStack width="full" gap={2}>
            <Box
              width="8px"
              height="8px"
              borderRadius="full"
              flexShrink={0}
              backgroundColor={
                chip.tone === "good"
                  ? "green.solid"
                  : chip.tone === "warning"
                    ? "orange.solid"
                    : chip.tone === "bad"
                      ? "red.solid"
                      : "border.emphasized"
              }
            />
            <Heading size="sm">
              {connectionProtocolName(connection.type)}
            </Heading>
            <Spacer />
            <IdentityChip
              label={chip.label}
              tone={chip.tone}
              title={chip.title}
            />
          </HStack>
          <HStack
            gap={6}
            paddingTop={2}
            borderTopWidth="1px"
            borderColor="border.muted"
            justify="space-between"
          >
            <Text fontSize="sm" fontWeight="medium">
              Identity provider
            </Text>
            <VStack align="end" gap={0} minWidth={0}>
              <Text fontSize="sm">{connection.providerId}</Text>
              {connection.issuer && (
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  color="fg.muted"
                  truncate
                  maxWidth="full"
                  title={connection.issuer}
                >
                  {connection.issuer}
                </Text>
              )}
            </VStack>
          </HStack>
          {goLive?.activated &&
            (goLive.routingSwitchedOn ? (
              <Alert.Root status="success">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Single sign-on is on</Alert.Title>
                  <Alert.Description>
                    People with an address at your proved domains now sign in
                    through your identity provider.
                  </Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ) : (
              <Alert.Root status="info">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>
                    The connection is on, and sign-in has not moved to it yet
                  </Alert.Title>
                  <Alert.Description>
                    Everyone still signs in the way they do today. Talk to us
                    when you are ready for us to switch your organization over —
                    we do it one organization at a time, so it can be undone
                    immediately.
                  </Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ))}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
