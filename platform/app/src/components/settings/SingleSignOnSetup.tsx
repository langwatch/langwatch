import {
  Button,
  Card,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type {
  SelfServeGoLiveView,
  SelfServeSetupView,
} from "@langwatch/identity-server";
import { Copy } from "lucide-react";
import { useState } from "react";
import {
  connectionProtocolName,
  connectionStatusChipFor,
} from "~/features/sso/logic/connectionStatus";
import { setupProgressFor } from "~/features/sso/logic/setupProgress";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { IdentityChip } from "../access/IdentityRow";
import { toaster } from "../ui/toaster";
import { ProtocolMark } from "./authentication/SingleSignOnCard";
import { SettingList, SettingRow } from "./kit/SettingRow";
import { SettingsCard } from "./kit/SettingsCard";
import { SettingsRowsSkeleton } from "./kit/SettingsSkeleton";
import { ArrivalsSection } from "./singleSignOn/ArrivalsSection";
import { BreakGlassSection } from "./singleSignOn/BreakGlassSection";
import { DomainsSection } from "./singleSignOn/DomainsSection";
import { GoLiveSection } from "./singleSignOn/GoLiveSection";
import { RegisterConnection } from "./singleSignOn/RegisterConnection";
import {
  AvailabilityRefusalNotice,
  LoadFailure,
  reportRefusal,
} from "./singleSignOn/refusals";
import { ServiceProviderDetails } from "./singleSignOn/ServiceProviderDetails";
import { SetupStep, SetupSteps } from "./singleSignOn/SetupStep";
import { TestSignInSection } from "./singleSignOn/TestSignInSection";

/**
 * The one line a finished arrivals step keeps when it closes.
 *
 * The step's whole point is that somebody decided, so the answer they gave is
 * what the closed step has to say — a tick alone would hide the very fact the
 * step exists to establish.
 */
const ARRIVALS_SUMMARY = {
  admit: "They join, on a domain you verified",
  request: "They ask, and you approve them",
  refuse: "Only people already here",
} as const;

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

  // The journey's own shape while its data lands — one placeholder row per
  // step, so the wizard arrives at the height it is going to keep rather
  // than jumping out of a bare "Loading…".
  if (setup.isLoading)
    return (
      <VStack align="stretch" gap={6} width="full">
        <SettingsRowsSkeleton rows={6} />
      </VStack>
    );
  // A read that failed says so, in the words registered for its code. It must
  // never fall through to the empty state below: "nothing is registered yet"
  // and "we could not find out" are different facts, and only one of them
  // means start typing.
  if (setup.error) {
    return <LoadFailure error={setup.error} what="single sign-on setup" />;
  }
  if (!setup.data) return <Text>Single sign-on setup is unavailable.</Text>;

  const { availability, connection, serviceProvider } =
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
        <SetupSteps>
          <SetupStep
            number={1}
            title="Connect your identity provider"
            state="current"
            last
          >
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
        </SetupSteps>
      </VStack>
    );
  }

  return (
    <ConnectedJourney
      organizationId={organizationId}
      canManage={canManage}
      view={setup.data as SelfServeSetupView}
      connection={connection}
    />
  );
}

/** The five steps once a connection exists, and the way back out below them. */
function ConnectedJourney({
  organizationId,
  canManage,
  view,
  connection,
}: {
  organizationId: string;
  canManage: boolean;
  view: SelfServeSetupView;
  connection: NonNullable<SelfServeSetupView["connection"]>;
}) {
  const { availability, claims, record, serviceProvider, goLive } = view;
  // The caller already refused an unavailable organization, but destructuring
  // here starts from the whole union again — so `proof`, which only the
  // available branch carries, was being read off a type that may not have it.
  const provesWithLicense =
    availability.available && availability.proof === "license-token";
  const progress = setupProgressFor({
    domainProved: goLive?.domainProved ?? false,
    testSignInDone: goLive?.testSignIn.done ?? false,
    breakGlassInPlace: goLive?.breakGlass.inPlace ?? false,
    arrivalsDecided: goLive?.arrivalsDecided ?? false,
    activated: goLive?.activated ?? false,
  });

  return (
    <VStack align="stretch" gap={6} width="full">
      <ConnectionSummary connection={connection} goLive={goLive} />

      <SetupSteps>
        <SetupStep
          number={1}
          title="Your identity provider"
          state={progress.provider}
          summary={connection.providerId}
        >
          <ServiceProviderDetails
            serviceProvider={serviceProvider}
            connected
            protocol={connection.type}
          />
        </SetupStep>

        <SetupStep
          number={2}
          title="Prove a domain is yours"
          state={progress.domain}
          summary={
            connection.verifiedDomains.length > 0
              ? `${connection.verifiedDomains.join(", ")} proved`
              : undefined
          }
        >
          <DomainsSection
            claims={claims}
            connection={connection}
            record={record}
            canManage={canManage}
            organizationId={organizationId}
            connectionId={connection.connectionId}
            provesWithLicense={provesWithLicense}
          />
        </SetupStep>

        <SetupStep
          number={3}
          title="Sign in through it once"
          state={progress.testSignIn}
          summary={
            goLive?.testSignIn.atMs
              ? `Worked on ${new Date(goLive.testSignIn.atMs).toLocaleString()}`
              : undefined
          }
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
          state={progress.breakGlass}
        >
          <BreakGlassSection
            organizationId={organizationId}
            canManage={canManage}
          />
        </SetupStep>

        <SetupStep
          number={5}
          title="Say who it lets in"
          state={progress.arrivals}
          summary={ARRIVALS_SUMMARY[connection.arrivalPolicy]}
        >
          <ArrivalsSection
            organizationId={organizationId}
            connectionId={connection.connectionId}
            canManage={canManage}
            policy={connection.arrivalPolicy}
          />
        </SetupStep>

        <SetupStep
          number={6}
          title="Turn it on"
          state={progress.goLive}
          note={progress.goLiveBlockedBecause ?? undefined}
          last
        >
          <GoLiveSection
            organizationId={organizationId}
            connectionId={connection.connectionId}
            canManage={canManage}
            goLive={goLive}
          />
        </SetupStep>
      </SetupSteps>

      {canManage && (
        <RemoveConnectionSection
          organizationId={organizationId}
          connectionId={connection.connectionId}
          providerName={connection.providerId}
          activated={goLive?.activated ?? false}
        />
      )}
    </VStack>
  );
}

/**
 * The way back out, at the bottom where every settings surface keeps its
 * regrets. Two different acts behind one section, and the copy says which
 * one this press is:
 *
 *   - a connection that never went live is DISCARDED — the journey opens
 *     back on the register step, immediately, and the history keeps what
 *     was tried;
 *   - a live connection is REMOVED on teardown's terms — scheduled, with a
 *     seven-day grace in which sign-in keeps working and the removal can
 *     be called off, and refused outright while anybody would be left with
 *     no other way in.
 *
 * DRAWN AS A DANGER ZONE, not as another hairline: the red-tinted border and
 * the red title say "destructive lives here" before a word is read, which is
 * the one thing a reader skimming to the bottom of a long page must not miss.
 */
function RemoveConnectionSection({
  organizationId,
  connectionId,
  providerName,
  activated,
}: {
  organizationId: string;
  connectionId: string;
  providerName: string;
  activated: boolean;
}) {
  const discard = api.ssoSetup.discardConnection.useMutation();
  const remove = api.ssoSetup.removeConnection.useMutation();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);
  const pending = discard.isPending || remove.isPending;

  const settle = {
    onSuccess: () => {
      setConfirming(false);
      void utils.ssoSetup.getSetup.invalidate();
    },
    onError: reportRefusal,
  };

  return (
    <Card.Root borderColor="red.muted">
      <Card.Body paddingX={4} paddingY={3.5} gap={3}>
        <Text fontSize="13.5px" fontWeight="semibold" color="red.fg">
          Danger zone
        </Text>
        <HStack
          justify="space-between"
          align={{ base: "stretch", sm: "center" }}
          gap={3}
          flexDirection={{ base: "column", sm: "row" }}
        >
          <Text fontSize="13px" color="fg.muted" maxWidth="64ch">
            {activated
              ? `Removing ${providerName} schedules it: sign-in keeps working for seven days, the removal can be called off in that time, and it is refused while anybody would have no other way in.`
              : `Removing ${providerName} takes you back to the start. Nothing about anybody's sign-in changes, and you can register a connection again at any time.`}
          </Text>
          {confirming ? (
            <HStack gap={2} flexShrink={0}>
              <Button
                size="sm"
                colorPalette="red"
                variant="solid"
                loading={pending}
                onClick={() =>
                  activated
                    ? remove.mutate(
                        { organizationId, connectionId, reason: null },
                        settle,
                      )
                    : discard.mutate({ organizationId, connectionId }, settle)
                }
              >
                {activated ? "Yes, schedule the removal" : "Yes, remove it"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Keep it
              </Button>
            </HStack>
          ) : (
            <Button
              size="sm"
              variant="outline"
              colorPalette="red"
              flexShrink={0}
              alignSelf={{ base: "start", sm: "center" }}
              onClick={() => setConfirming(true)}
            >
              Remove this connection
            </Button>
          )}
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}

/**
 * Where the connection stands, and — separately — whether anybody is actually
 * being sent to it.
 *
 * The two are different facts and the card says both. An ACTIVE connection
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

  /** The issuer, whole, to the clipboard — the same toast the copy rows give. */
  const copyIssuer = () => {
    if (!connection.issuer) return;
    if (!navigator.clipboard) {
      toaster.create({
        title:
          "Your browser does not support clipboard access, please copy the issuer address manually",
        type: "error",
        duration: 2000,
      });
      return;
    }
    void navigator.clipboard.writeText(connection.issuer).then(() => {
      toaster.create({
        title: "Issuer address copied to your clipboard",
        type: "success",
        duration: 2000,
      });
    });
  };

  return (
    <SettingsCard
      title={connectionProtocolName(connection.type)}
      leading={<ProtocolMark type={connection.type} />}
      // The chip's "good" is the dot's "ok" — one state, two vocabularies.
      tone={chip.tone === "good" ? "ok" : chip.tone}
      badge={
        <IdentityChip
          label={chip.label}
          tone={chip.tone}
          title={chip.title}
          shimmer={chip.shimmer}
        />
      }
    >
      <SettingList>
        <SettingRow label="Identity provider">
          <VStack align="start" gap={0} minWidth={0}>
            <Text fontSize="sm">{connection.providerId}</Text>
            {connection.issuer && (
              <HStack gap={1} minWidth={0} maxWidth="full">
                {/* The scheme is chrome, not information — every issuer here
                    is https, so the display drops it. The whole address is on
                    the hover, and the button puts it on the clipboard. */}
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  color="fg.muted"
                  truncate
                  maxWidth="full"
                  title={connection.issuer}
                >
                  {connection.issuer.replace(/^https?:\/\//, "")}
                </Text>
                <IconButton
                  aria-label="Copy issuer address"
                  size="xs"
                  variant="ghost"
                  flexShrink={0}
                  color="fg.subtle"
                  _hover={{ color: "fg.muted" }}
                  onClick={copyIssuer}
                >
                  <Copy size={12} />
                </IconButton>
              </HStack>
            )}
          </VStack>
        </SettingRow>
      </SettingList>
      {/* THE CHIP ALREADY SAID THIS. A full-width coloured banner under a
          summary whose own status chip reads "On, not routing yet" is the
          same fact twice, in the loudest treatment on the page, about a
          state that is ordinary rather than wrong — and it pushed the
          checklist somebody came to work through below the fold.

          What the banner alone carried is the one thing the chip cannot
          fit: that the move is ours to make and reversible. That is a
          line, and it sits where the state it qualifies is. */}
      {goLive?.activated && !goLive.routingSwitchedOn && (
        <Text fontSize="xs" color="fg.muted" lineHeight="1.6">
          Everyone still signs in the way they do today. Talk to us when you are
          ready for us to switch your organization over — one organization at a
          time, and it can be undone immediately.
        </Text>
      )}
    </SettingsCard>
  );
}
