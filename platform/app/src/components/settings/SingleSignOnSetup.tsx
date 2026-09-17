import {
  Box,
  Button,
  Card,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { SsoConnectionLifecycleState } from "@langwatch/identity";
import type {
  SelfServeGoLiveView,
  SelfServeSetupView,
} from "@langwatch/identity-server";
import { Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
  arrivalAnswerLabel,
  SSO_ANSWER_BY_POLICY,
} from "~/features/sso/logic/arrivals";
import {
  connectionRemovalActFor,
  connectionRemovalCopyFor,
} from "~/features/sso/logic/connectionRemoval";
import {
  connectionProtocolName,
  connectionStatusChipFor,
} from "~/features/sso/logic/connectionStatus";
import { providerDisplayName } from "~/features/sso/logic/providerDisplayName";
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
import { ConnectionNameRow } from "./singleSignOn/ConnectionNameRow";
import { DomainsSection } from "./singleSignOn/DomainsSection";
import { GoLiveSection } from "./singleSignOn/GoLiveSection";
import { HistorySection } from "./singleSignOn/HistorySection";
import { LegacyRouteNotice } from "./singleSignOn/LegacyRouteNotice";
import { MigrationProgress } from "./singleSignOn/migration-progress";
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

  // Named once rather than re-asserted at each use: the same value was cast
  // three times, and three casts of one value are three places to disagree.
  const view = setup.data as SelfServeSetupView;
  const { availability, connection, legacyRoute } = view;

  // The refusal itself is the Authentication page's to place, above the
  // cards that explain what single sign-on would give this organization. A
  // journey that cannot be started is not a screen.
  if (!availability.available) {
    return <AvailabilityRefusalNotice refusal={availability.refusal} />;
  }

  // BEFORE the empty state, because an organization already routing people
  // through a provider is not an empty one — it only looks that way until the
  // old route has been recorded as a connection.
  //
  // Truthiness rather than `!== null`, because an ABSENT field is not a route
  // either: a payload from a server that predates this field arrives with it
  // undefined, and `undefined !== null` would have hidden the setup journey
  // from every organization mid-deploy.
  if (connection === null && legacyRoute) {
    return <LegacyRouteNotice legacyRoute={legacyRoute} />;
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
                serviceProvider={view.serviceProviderBeforeRegistration}
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

  if (connection.source === "legacy-grandfathered") {
    return (
      <LegacyMigrationStart
        organizationId={organizationId}
        canManage={canManage}
        view={view}
        connection={connection}
      />
    );
  }

  return (
    <ConnectedJourney
      organizationId={organizationId}
      canManage={canManage}
      view={view}
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
  const { availability, goLive } = view;
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
      {view.migration && (
        <MigrationProgress
          organizationId={organizationId}
          canManage={canManage}
          migration={view.migration}
          connectionState={connection.state}
        />
      )}
      <ConnectionSummary
        organizationId={organizationId}
        connection={connection}
        goLive={goLive}
        canManage={canManage}
        goLiveBlockedBecause={progress.goLiveBlockedBecause}
      />

      <SetupJourneySteps
        organizationId={organizationId}
        canManage={canManage}
        connection={connection}
        view={view}
        progress={progress}
        provesWithLicense={provesWithLicense}
      />

      {/* Held to `sso:manage`, unlike everything above it on this screen —
          see `ssoSetup.getHistory`'s own docblock for why the history is a
          stronger disclosure than the state everyone with `sso:view` may
          already read. */}
      {canManage && (
        <HistorySection
          organizationId={organizationId}
          connectionId={connection.connectionId}
        />
      )}

      {canManage && (
        <RemoveConnectionSection
          organizationId={organizationId}
          connectionId={connection.connectionId}
          providerName={connection.providerId}
          state={connection.state}
          tearDownAfterMs={connection.tearDownAfterMs}
        />
      )}
    </VStack>
  );
}

function LegacyMigrationStart({
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
  const [configuring, setConfiguring] = useState(false);
  // The provider this organization is actually leaving, rather than the one
  // that prompted the feature. Nothing has switched yet on this screen, so a
  // provider we cannot spell is "your current provider" here.
  const name = providerDisplayName(connection.providerId);
  const current = name ?? "your current provider";
  return (
    <VStack align="stretch" gap={6} width="full">
      <SettingsCard
        title={name ? `${name} single sign-on` : "Your current single sign-on"}
        badge={<IdentityChip label="Active" tone="good" />}
      >
        <Text fontSize="sm">
          {name
            ? `Your existing ${name} sign-in remains active until you explicitly switch normal traffic to its replacement.`
            : "Your existing sign-in remains active until you explicitly switch normal traffic to its replacement."}
        </Text>
        {canManage && !configuring && (
          <Button alignSelf="start" onClick={() => setConfiguring(true)}>
            Migrate from {current}
          </Button>
        )}
      </SettingsCard>
      <SettingsCard title={`Who can join through ${current}`}>
        <ArrivalsSection
          organizationId={organizationId}
          connectionId={connection.connectionId}
          canManage={canManage}
          policy={connection.arrivalPolicy}
        />
      </SettingsCard>
      {canManage && configuring && (
        <SettingsCard title="Set up the replacement">
          {/* NOT `view.serviceProvider`, which is keyed on the connection
              being REPLACED - pasting that into the new identity provider
              would point it at the one on its way out. */}
          <RegisterConnection
            organizationId={organizationId}
            serviceProvider={view.serviceProviderBeforeRegistration}
            replacesConnectionId={connection.connectionId}
          />
        </SettingsCard>
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
 *   - a connection that reached live is REMOVED on teardown's terms —
 *     scheduled, with a grace in which sign-in keeps working, and refused
 *     outright while anybody would be left with no other way in;
 *   - a connection ALREADY being removed says so, with the date, and the
 *     press re-derives that date from now rather than refusing.
 *
 * Which of the three is read from the connection's lifecycle state by
 * {@link connectionRemovalActFor}, never from whether it is activated.
 * "Activated" means ACTIVE and nothing else, so a paused connection and one
 * already on its way out both read as never-went-live, and both then sent a
 * discard the aggregate refuses. The state is the fact the guard consults, so
 * it is the fact this section asks for.
 *
 * DRAWN AS A DANGER ZONE, not as another hairline: the red-tinted border and
 * the red title say "destructive lives here" before a word is read, which is
 * the one thing a reader skimming to the bottom of a long page must not miss.
 */
function RemoveConnectionSection({
  organizationId,
  connectionId,
  providerName,
  state,
  tearDownAfterMs,
}: {
  organizationId: string;
  connectionId: string;
  providerName: string;
  state: SsoConnectionLifecycleState;
  tearDownAfterMs: number | null;
}) {
  const discard = api.ssoSetup.discardConnection.useMutation();
  const remove = api.ssoSetup.removeConnection.useMutation();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);
  const pending = discard.isPending || remove.isPending;
  const act = connectionRemovalActFor(state);

  const settle = {
    onSuccess: () => {
      setConfirming(false);
      void utils.ssoSetup.getSetup.invalidate();
    },
    onError: reportRefusal,
  };

  // A tombstone has no way out left, and a section headed "danger zone" whose
  // only control cannot do anything is worse than no section.
  if (act.verb === "none") return null;

  const copy = connectionRemovalCopyFor({
    act,
    providerName,
    scheduledFor:
      tearDownAfterMs === null
        ? null
        : new Date(tearDownAfterMs).toLocaleDateString(),
  });

  return (
    /* A DANGER ZONE THAT LOOKS LIKE EVERY OTHER CARD IS NOT ONE. A hairline
       in red and a red heading were the entire signal, and at a glance that
       is no signal — the region read as one more settings card until the
       words were read, which is the wrong order for the only control on this
       page that ends people's sign-in. The wash is what makes it a region
       rather than a card; the mark beside the heading is what carries the
       same meaning to a reader who does not get the colour. */
    <Card.Root borderColor="red.muted" background="red.subtle">
      <Card.Body paddingX={4} paddingY={3.5} gap={3}>
        <HStack gap={2} align="center">
          <Box color="red.fg" display="flex" flexShrink={0} aria-hidden="true">
            <TriangleAlert size={14} />
          </Box>
          <Text fontSize="13.5px" fontWeight="semibold" color="red.fg">
            Danger zone
          </Text>
        </HStack>
        <HStack
          justify="space-between"
          align={{ base: "stretch", sm: "center" }}
          gap={3}
          flexDirection={{ base: "column", sm: "row" }}
        >
          <Text fontSize="13px" color="fg.muted" maxWidth="64ch">
            {copy.explanation}
          </Text>
          {confirming ? (
            <HStack gap={2} flexShrink={0}>
              <Button
                size="sm"
                colorPalette="red"
                variant="solid"
                loading={pending}
                data-testid="sso-remove-confirm"
                onClick={() =>
                  act.verb === "teardown"
                    ? remove.mutate(
                        { organizationId, connectionId, reason: null },
                        settle,
                      )
                    : discard.mutate({ organizationId, connectionId }, settle)
                }
              >
                {copy.confirm}
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
              data-testid="sso-remove-open"
              onClick={() => setConfirming(true)}
            >
              {copy.open}
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
/**
 * The issuer, whole, to the clipboard - the same toast the copy rows give.
 *
 * Module level rather than a closure, so the card it belongs to stays a card:
 * nothing here reads a prop or a hook, only the one string handed in.
 */
function copyIssuerToClipboard(issuer: string | null | undefined): void {
  if (!issuer) return;
  if (!navigator.clipboard) {
    toaster.create({
      title:
        "Your browser does not support clipboard access, please copy the issuer address manually",
      type: "error",
      duration: 2000,
    });
    return;
  }
  void navigator.clipboard.writeText(issuer).then(() => {
    toaster.create({
      title: "Issuer address copied to your clipboard",
      type: "success",
      duration: 2000,
    });
  });
}

function ConnectionSummary({
  organizationId,
  connection,
  goLive,
  canManage,
  goLiveBlockedBecause,
}: {
  organizationId: string;
  connection: NonNullable<SelfServeSetupView["connection"]>;
  goLive: SelfServeGoLiveView | null;
  canManage: boolean;
  /** Why turning it on is not available yet, or null when it is. */
  goLiveBlockedBecause: string | null;
}) {
  // The chip and step six read the same fact, so a proved domain cannot
  // announce itself ready two inches above a step that says it is waiting.
  const chip = connectionStatusChipFor({
    state: connection.state,
    goLiveBlockedBecause,
  });
  const copyIssuer = () => copyIssuerToClipboard(connection.issuer);

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
        {/* "Name" rather than "Identity provider": the card's own title
            already says which protocol this is, and what sat here was never
            an identifier — see `ConnectionNameRow`. */}
        {/* A ROW EACH, WHERE THE ISSUER USED TO HANG UNDER THE NAME. They are
            two different facts — one the customer picks and can change, one
            the provider fixes — and stacking the second inside the first left
            this card with a single row. A half-and-half grid renders one row
            as a label marooned against one edge and its value against the
            other, which is the stretched field this card was reported as.
            Given a row each they land on the same line as every other
            settings card in the cluster. */}
        <SettingRow
          label="Name"
          hint="Yours to change. It renames nothing at your provider."
        >
          <ConnectionNameRow
            organizationId={organizationId}
            connectionId={connection.connectionId}
            name={connection.providerId}
            canManage={canManage}
          />
        </SettingRow>
        {connection.issuer && (
          <SettingRow
            label="Issuer"
            hint="The address your provider identifies itself by."
          >
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
          </SettingRow>
        )}
      </SettingList>
      {/* WHAT TURNING IT ON DID, and the way back — the REAL one. This used
          to promise "turn the connection off to move them back, it takes
          effect immediately", and there is no such control on this page or
          anywhere else the customer can reach: suspending is deliberately an
          operator's lever (specs/identity/sso-activation.feature), and the
          only control here SCHEDULES a removal with a grace period. An
          administrator who read that sentence and then went looking for the
          switch found the danger zone instead. */}
      {goLive?.activated && (
        <Text fontSize="xs" color="fg.muted" lineHeight="1.6">
          People with an address at your proved domains now sign in through your
          identity provider. Anybody holding a way back in can still sign in
          directly. To undo this, remove the connection below — sign-in keeps
          working through a grace period, and we refuse it while it would leave
          somebody with no way in.
        </Text>
      )}
    </SettingsCard>
  );
}

/**
 * The six steps of setting a connection up, in the order they are done.
 *
 * A CLOSED step keeps the answer somebody gave — a tick alone would hide the
 * very fact the step exists to establish — and keeps it in the shared
 * vocabulary, so the summary here is the label on the radio and the row on the
 * overview, word for word.
 */
function SetupJourneySteps({
  organizationId,
  canManage,
  connection,
  view,
  progress,
  provesWithLicense,
}: {
  organizationId: string;
  canManage: boolean;
  connection: NonNullable<SelfServeSetupView["connection"]>;
  view: SelfServeSetupView;
  progress: ReturnType<typeof setupProgressFor>;
  provesWithLicense: boolean;
}) {
  const { claims, record, serviceProvider, goLive } = view;
  return (
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
          connectionState={connection.state}
          verifiedDomains={connection.verifiedDomains}
        />
      </SetupStep>

      <GoLiveSteps
        organizationId={organizationId}
        canManage={canManage}
        connection={connection}
        progress={progress}
        goLive={goLive}
      />
    </SetupSteps>
  );
}

/**
 * The last three steps: a way back in, who it lets in, and turning it on.
 *
 * They are the ones that change what happens to OTHER PEOPLE, which is why
 * they come after the connection has been proved and signed into once.
 */
function GoLiveSteps({
  organizationId,
  canManage,
  connection,
  progress,
  goLive,
}: {
  organizationId: string;
  canManage: boolean;
  connection: NonNullable<SelfServeSetupView["connection"]>;
  progress: ReturnType<typeof setupProgressFor>;
  goLive: SelfServeSetupView["goLive"];
}) {
  return (
    <>
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

      {/* The closed step keeps the answer somebody gave — a tick alone
          would hide the very fact the step exists to establish — and it
          keeps it in the shared vocabulary, so the summary here is the
          label on the radio and the row on the overview, word for word. */}
      <SetupStep
        number={5}
        title="Say who it lets in"
        state={progress.arrivals}
        summary={arrivalAnswerLabel(
          SSO_ANSWER_BY_POLICY[connection.arrivalPolicy],
        )}
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
    </>
  );
}
