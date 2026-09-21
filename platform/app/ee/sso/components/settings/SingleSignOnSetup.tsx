import {
  Box,
  Button,
  Card,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  arrivalAnswerLabel,
  SSO_ANSWER_BY_POLICY,
} from "@ee/sso/logic/arrivals";
import {
  connectionRemovalActFor,
  connectionRemovalCopyFor,
} from "@ee/sso/logic/connectionRemoval";
import {
  connectionProtocolName,
  connectionStatusChipFor,
} from "@ee/sso/logic/connectionStatus";
import { providerDisplayName } from "@ee/sso/logic/providerDisplayName";
import { setupProgressFor } from "@ee/sso/logic/setupProgress";
import type {
  SelfServeGoLiveView,
  SelfServeSetupView,
} from "@ee/sso/sso-self-serve.types";
import type { SsoConnectionLifecycleState } from "@langwatch/identity";
import { Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { SettingList, SettingRow } from "~/components/settings/kit/SettingRow";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";
import { SettingsRowsSkeleton } from "~/components/settings/kit/SettingsSkeleton";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { ProtocolMark } from "./authentication/SingleSignOnCard";
import { ArrivalsSection } from "./singleSignOn/ArrivalsSection";
import { BreakGlassSection } from "./singleSignOn/BreakGlassSection";
import { ConnectionNameRow } from "./singleSignOn/ConnectionNameRow";
import { DomainsSection } from "./singleSignOn/DomainsSection";
import { GoLiveSection } from "./singleSignOn/GoLiveSection";
import { HistorySection } from "./singleSignOn/HistorySection";
import { LegacyRouteNotice } from "./singleSignOn/LegacyRouteNotice";
import { MigrationProgress } from "./singleSignOn/migration-progress";
import { PendingSetupChange } from "./singleSignOn/pending-setup-change";
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
 * Customer single sign-on setup. The service owns lifecycle state and this
 * screen renders the available steps for the reader's permissions; operator
 * domain attestation stays in the back office.
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

  if (setup.isLoading)
    return (
      <VStack align="stretch" gap={6} width="full">
        <SettingsRowsSkeleton rows={6} />
      </VStack>
    );
  if (setup.error) {
    return <LoadFailure error={setup.error} what="single sign-on setup" />;
  }
  if (!setup.data) return <Text>Single sign-on setup is unavailable.</Text>;

  const view = setup.data as SelfServeSetupView;
  const { availability, connection, legacyRoute } = view;

  if (!availability.available) {
    return <AvailabilityRefusalNotice refusal={availability.refusal} />;
  }

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

/**
 * An organization signing in through the provider LangWatch set up for it,
 * and the one thing it can do about that: connect its own.
 *
 * THE FORM IS THE FIRST-TIME JOURNEY'S, given the connection it replaces. A
 * second copy of eight fields and two protocols is a second place for them to
 * go wrong.
 *
 * WHAT DOES NOT HAPPEN COMES FIRST. Somebody about to type their identity
 * provider's credentials into a page that is signing their whole company in
 * needs to know, before they touch a field, that their people keep signing in
 * as they do today until an administrator switches over, and that switching
 * back is available.
 */
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
  const name = providerDisplayName(connection.providerId);
  const current = name ?? "your existing provider";
  return (
    <VStack align="stretch" gap={6} width="full">
      <SettingsCard
        title="Single sign-on is active"
        badge={<IdentityChip label="Active" tone="good" />}
      >
        <Text fontSize="sm">
          {name
            ? `Your people sign in through ${name} today. Connect your organization's own identity provider to take that over.`
            : "Your people sign in through the provider set up for your organization today. Connect your organization's own identity provider to take that over."}
        </Text>
      </SettingsCard>

      <SetupSteps>
        <SetupStep
          number={1}
          title="Update single sign-on"
          state="current"
          last
        >
          {canManage ? (
            <VStack align="stretch" gap={4}>
              <UpdatePromises current={current} />
              <RegisterConnection
                organizationId={organizationId}
                serviceProvider={view.serviceProviderBeforeRegistration}
                replacesConnectionId={connection.connectionId}
              />
            </VStack>
          ) : (
            // Never a disabled form. A reader without `sso:manage` is told
            // who can do this and left with a page that still answers what
            // they came for, rather than a control that refuses them.
            <Text color="fg.muted" fontSize="sm">
              An organization administrator can connect your own identity
              provider here. Nothing changes for anybody signing in until they
              do.
            </Text>
          )}
        </SetupStep>
      </SetupSteps>

      <SettingsCard title={`Who can join through ${current}`}>
        <ArrivalsSection
          organizationId={organizationId}
          connectionId={connection.connectionId}
          connectionState={connection.state}
          canManage={canManage}
          policy={connection.arrivalPolicy}
          decided={view.goLive?.arrivalsDecided ?? false}
        />
      </SettingsCard>
    </VStack>
  );
}

/** What connecting your own identity provider does, and what it does not. */
function UpdatePromises({ current }: { current: string }) {
  return (
    <VStack align="stretch" gap={1.5}>
      <Text fontSize="sm" color="fg.muted">
        Everyone keeps signing in through {current} while you set the new
        connection up and test it.
      </Text>
      <Text fontSize="sm" color="fg.muted">
        Nothing changes for your members until an administrator switches sign-in
        over.
      </Text>
      <Text fontSize="sm" color="fg.muted">
        You can switch back to {current} at any point before you finish the
        update.
      </Text>
    </VStack>
  );
}

function useConnectionRemoval({
  organizationId,
  connectionId,
  state,
}: {
  organizationId: string;
  connectionId: string;
  state: SsoConnectionLifecycleState;
}) {
  const discard = api.ssoSetup.discardConnection.useMutation();
  const remove = api.ssoSetup.removeConnection.useMutation();
  const utils = api.useUtils();
  const [confirming, setConfirming] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const pending = discard.isPending || remove.isPending || waiting;
  const act = connectionRemovalActFor(state);

  const settle = {
    onSuccess: () => {
      setConfirming(false);
      setWaiting(true);
      void utils.ssoSetup.getSetup.invalidate();
    },
    onError: reportRefusal,
  };

  const submit = () => {
    if (act.verb === "teardown") {
      remove.mutate({ organizationId, connectionId, reason: null }, settle);
    } else {
      discard.mutate({ organizationId, connectionId }, settle);
    }
  };
  return {
    act,
    confirming,
    setConfirming,
    waiting,
    setWaiting,
    pending,
    submit,
  };
}

/** Render the lifecycle-specific discard or teardown action. */
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
  const {
    act,
    confirming,
    setConfirming,
    waiting,
    setWaiting,
    pending,
    submit,
  } = useConnectionRemoval({ organizationId, connectionId, state });

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
                onClick={submit}
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
              loading={pending}
              disabled={pending}
              data-testid="sso-remove-open"
              onClick={() => setConfirming(true)}
            >
              {copy.open}
            </Button>
          )}
        </HStack>
        {waiting && (
          <PendingSetupChange
            organizationId={organizationId}
            isSettled={(setup) =>
              act.verb === "teardown"
                ? setup.connection === null ||
                  setup.connection.state === "TEARDOWN_PENDING"
                : setup.connection === null
            }
            onSettled={() => setWaiting(false)}
          >
            Removal accepted. Updating your connection status…
          </PendingSetupChange>
        )}
      </Card.Body>
    </Card.Root>
  );
}

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
          People at your verified domains sign in through your identity
          provider. Your recovery administrator can still sign in directly.
          Before removing this connection, make sure everyone has another
          verified sign-in method. Removal stops new SSO sign-ins and SCIM
          provisioning immediately.
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
          connectionState={connection.state}
          canManage={canManage}
          policy={connection.arrivalPolicy}
          decided={goLive?.arrivalsDecided ?? false}
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
