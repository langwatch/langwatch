// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * An organization's own single sign-on setup: one read, and the steps that
 * move it. A step whose command identity does not answer yet is not mounted —
 * a control that cannot do anything reads as a broken one (handoff §10).
 */
import { Heading, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { useEffect, useState } from "react";

import { ssoApi } from "../../behavior/sso-api.ts";
import { useMigrationMembers } from "../../behavior/use-migration-members.ts";
import { useSettlingSetup } from "../../behavior/use-settling-setup.ts";
import { arrivalAnswerLabel, SSO_ANSWER_BY_POLICY } from "../../model/arrivals.ts";
import { setupProgressFor } from "../../model/setup-progress.ts";
import {
  domainClaimsOf,
  domainEvidenceOf,
  goLiveFactsOf,
  provesWithLicense,
} from "../../model/setup-view.ts";
import { useSsoHost } from "../../model/sso-host.ts";
import { ConnectionNameRow } from "../elements/connection-name-row.tsx";
import { LegacyRouteNotice } from "../elements/legacy-route-notice.tsx";
import { LoadFailure } from "../elements/refusals.tsx";
import { SetupStep, SetupSteps } from "../elements/setup-step.tsx";
import { ArrivalsSection } from "./arrivals.section.tsx";
import { BreakGlassSection } from "./break-glass.section.tsx";
import {
  ConnectionRemovalSection,
  type ConnectionRemovalCommand,
} from "./connection-removal.section.tsx";
import { DomainsSection } from "./domains.section.tsx";
import { GoLiveSection } from "./go-live.section.tsx";
import { HistorySection } from "./history.section.tsx";
import { MigrationProgressSection } from "./migration-progress.section.tsx";
import { RegisterConnectionSection } from "./register-connection.section.tsx";
import { ServiceProviderSection } from "./service-provider.section.tsx";
import { TestSignInSection } from "./test-sign-in.section.tsx";

type SetupConnection = NonNullable<SsoSetupPageView["connection"]>;

export default function SsoSetupScreen() {
  const organizationId = useSsoHost().organizationId();

  if (!organizationId) return null;

  return (
    <VStack align="stretch" gap={6} width="full">
      <VStack align="start" gap={1}>
        <Heading as="h2">Identity provider</Heading>
        <Text color="fg.muted">
          Where your people sign in, and everything it takes to put it in front of them.
        </Text>
      </VStack>
      <SsoSetupPage organizationId={organizationId} />
    </VStack>
  );
}

function SsoSetupPage({ organizationId }: { organizationId: string }) {
  const setup = ssoApi.ssoSetup.getSetup.useQuery({ organizationId });

  if (setup.isLoading) return <Skeleton height="220px" width="full" />;

  // A read that failed is not an organization without single sign-on: the
  // journey's first step would invite somebody to register a second provider.
  if (setup.isError) return <LoadFailure error={setup.error} what="single sign-on setup" />;

  if (!setup.data) {
    return (
      <Text color="fg.error" fontSize="sm" data-testid="sso-setup-unavailable">
        Your single sign-on setup could not be loaded.
      </Text>
    );
  }

  const view = setup.data;

  if (view.connection === null) {
    return view.legacyRoute ? (
      <LegacyRouteNotice legacyRoute={view.legacyRoute} />
    ) : (
      <UnregisteredJourney organizationId={organizationId} serviceProvider={view.serviceProvider} />
    );
  }

  return (
    <ConnectedJourney organizationId={organizationId} view={view} connection={view.connection} />
  );
}

/** Nothing registered yet: the whole page is the one step that changes that. */
function UnregisteredJourney({
  organizationId,
  serviceProvider,
}: {
  organizationId: string;
  serviceProvider: SsoSetupPageView["serviceProvider"];
}) {
  const canManage = useSsoHost().canManage();
  const utils = ssoApi.useUtils();

  return (
    <VStack align="stretch" gap={6} width="full" data-testid="sso-setup">
      <SetupSteps>
        <SetupStep number={1} title="Connect your identity provider" state="current" last>
          <RegisterConnectionSection
            organizationId={organizationId}
            serviceProvider={serviceProvider}
            canManage={canManage}
            onRegistered={() => utils.ssoSetup.getSetup.invalidate()}
          />
        </SetupStep>
      </SetupSteps>
    </VStack>
  );
}

function ConnectedJourney({
  organizationId,
  view,
  connection,
}: {
  organizationId: string;
  view: SsoSetupPageView;
  connection: SetupConnection;
}) {
  const host = useSsoHost();
  const canManage = host.canManage();
  const utils = ssoApi.useUtils();
  const discard = ssoApi.ssoSetup.discardConnection.useMutation();
  const remove = ssoApi.ssoSetup.removeConnection.useMutation();
  const selectRoute = ssoApi.ssoSetup.selectMigrationRoute.useMutation();
  const finalize = ssoApi.ssoSetup.finalizeLegacyMigration.useMutation();
  // Set between a removal being accepted and the read catching up, so the
  // danger zone says the press landed rather than looking like it did nothing.
  const [removalAccepted, setRemovalAccepted] = useState(false);
  const connectionId = connection.connectionId;
  const migration = view.migration;

  useEffect(() => {
    setRemovalAccepted(false);
  }, [connection.state, connection.tearDownAfterMs]);

  const refresh = () => {
    void utils.ssoSetup.getSetup.invalidate();
  };

  // An accepted removal reaches the projection a moment later, so the page
  // keeps reading until what it shows is what happened.
  useSettlingSetup({ organizationId, waiting: removalAccepted });

  const selectMigrationRoute = (route: "legacy" | "direct") => {
    selectRoute.mutate({ organizationId, connectionId, route }, { onSuccess: refresh });
  };

  const finalizeMigration = () => {
    finalize.mutate({ organizationId, connectionId }, { onSuccess: refresh });
  };

  const removeConnection = (command: ConnectionRemovalCommand) => {
    const settle = {
      onSuccess: () => {
        setRemovalAccepted(true);
        refresh();
      },
      onError: (error: unknown) =>
        host.failed({ error, fallbackTitle: "Removing this connection" }),
    };

    if (command.verb === "teardown") {
      remove.mutate({ organizationId, connectionId, reason: null }, settle);
    } else {
      discard.mutate({ organizationId, connectionId }, settle);
    }
  };

  return (
    <VStack align="stretch" gap={6} width="full" data-testid="sso-setup">
      {view.legacyRoute && <LegacyRouteNotice legacyRoute={view.legacyRoute} />}

      {/* Above the journey: while a pair stands, where sign-in goes is the
          fact that decides what every step below it means. */}
      {migration && (
        <MigrationCard
          organizationId={organizationId}
          connectionId={connectionId}
          migration={migration}
          canManage={canManage}
          connectionActive={connection.state === "ACTIVE"}
          pending={selectRoute.isPending || finalize.isPending}
          refusal={selectRoute.error ?? finalize.error}
          onSelectRoute={selectMigrationRoute}
          onFinalize={finalizeMigration}
        />
      )}

      <SetupJourneySteps
        organizationId={organizationId}
        view={view}
        connection={connection}
        canManage={canManage}
        onChanged={refresh}
      />

      {/* `sso:manage`, unlike everything above: the history is nearer an audit
          trail than a state, and the removal is the page's one way out. */}
      {canManage && <HistorySection organizationId={organizationId} connectionId={connectionId} />}

      {canManage && (
        <ConnectionRemovalSection
          state={connection.state}
          providerName={connection.providerId}
          tearDownAfterMs={connection.tearDownAfterMs}
          pending={discard.isPending || remove.isPending}
          settling={removalAccepted}
          onRemove={removeConnection}
        />
      )}
    </VStack>
  );
}

/**
 * The cutover, with the members paged where they are read. The card itself
 * is props-driven; only this knows there is a second page to ask for.
 */
function MigrationCard({
  organizationId,
  connectionId,
  migration,
  canManage,
  connectionActive,
  pending,
  refusal,
  onSelectRoute,
  onFinalize,
}: {
  organizationId: string;
  connectionId: string;
  migration: NonNullable<SsoSetupPageView["migration"]>;
  canManage: boolean;
  connectionActive: boolean;
  pending: boolean;
  refusal: unknown;
  onSelectRoute: (route: "legacy" | "direct") => void;
  onFinalize: () => void;
}) {
  const paging = useMigrationMembers({
    organizationId,
    connectionId,
    firstPage: migration.members,
  });

  return (
    <MigrationProgressSection
      migration={migration}
      canManage={canManage}
      connectionActive={connectionActive}
      pending={pending}
      refusal={refusal}
      onSelectRoute={onSelectRoute}
      onFinalize={onFinalize}
      {...paging}
    />
  );
}

/**
 * The journey itself: five steps, in the order the work happens in. It owns
 * the commands its own steps press, so the page around it keeps the two that
 * are not steps — the cutover above and the way out below.
 */
function SetupJourneySteps({
  organizationId,
  view,
  connection,
  canManage,
  onChanged,
}: {
  organizationId: string;
  view: SsoSetupPageView;
  connection: SetupConnection;
  canManage: boolean;
  onChanged: () => void;
}) {
  const host = useSsoHost();
  const setArrivals = ssoApi.ssoSetup.setArrivals.useMutation();
  const rename = ssoApi.ssoSetup.rename.useMutation();
  const activate = ssoApi.ssoSetup.activate.useMutation();
  // Set between an activation being accepted and the read saying ACTIVE.
  const [activationAccepted, setActivationAccepted] = useState(false);
  const connectionId = connection.connectionId;
  const facts = goLiveFactsOf(view.goLive);

  useEffect(() => {
    setActivationAccepted(false);
  }, [connection.state]);

  useSettlingSetup({ organizationId, waiting: activationAccepted });

  const progress = setupProgressFor(facts);

  const saveArrivals = (policy: SetupConnection["arrivalPolicy"]) => {
    // No toast: the refusal is rendered beside the control that caused it,
    // where the reader is still mid-step.
    setArrivals.mutate({ organizationId, connectionId, policy }, { onSuccess: onChanged });
  };

  const goLive = () => {
    // No toast here either: the refusal names the precondition that is still
    // outstanding, which is a sentence the reader acts on in place.
    activate.mutate(
      { organizationId, connectionId },
      {
        onSuccess: () => {
          setActivationAccepted(true);
          onChanged();
        },
      },
    );
  };

  const renameConnection = (command: { name: string }) => {
    rename.mutate(
      { organizationId, connectionId, name: command.name },
      {
        onSuccess: onChanged,
        onError: (error) => host.failed({ error, fallbackTitle: "Renaming this connection" }),
      },
    );
  };

  return (
    <SetupSteps>
      <SetupStep
        number={1}
        title="Your identity provider"
        state={progress.provider}
        summary={connection.providerId}
      >
        <VStack align="stretch" gap={3}>
          {/* The word on the card, edited in place: nothing routes on it,
                so a whole screen for one string would be furniture. */}
          <HStack gap={2}>
            <Text color="fg.muted" fontSize="sm">
              Name
            </Text>
            <ConnectionNameRow
              name={connection.providerId}
              canManage={canManage}
              renaming={rename.isPending}
              onRename={renameConnection}
            />
          </HStack>
          <ServiceProviderSection
            protocol={connection.type}
            addresses={view.serviceProvider}
            connected
          />
        </VStack>
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
          organizationId={organizationId}
          connectionId={connectionId}
          canManage={canManage}
          provesWithLicense={provesWithLicense({ connection, record: view.record })}
          evidence={domainEvidenceOf(connection)}
          claims={domainClaimsOf(view.claims)}
          onChanged={onChanged}
        />
      </SetupStep>

      <SetupStep number={3} title="Sign in through it once" state={progress.testSignIn}>
        <TestSignInSection
          connectionId={connectionId}
          providerName={connection.providerId}
          canManage={canManage}
          testSignIn={{ done: facts.testSignInDone, atMs: null }}
          connectionState={connection.state}
          verifiedDomains={connection.verifiedDomains}
        />
      </SetupStep>

      {/* Before the last two steps, because it is the one that decides what
            happens when the identity provider cannot answer at all. */}
      <SetupStep number={4} title="Name someone who can still get in" state={progress.breakGlass}>
        <BreakGlassStep
          organizationId={organizationId}
          canManage={canManage}
          onChanged={onChanged}
        />
      </SetupStep>

      <SetupStep
        number={5}
        title="Say who it lets in"
        state={progress.arrivals}
        summary={arrivalAnswerLabel(SSO_ANSWER_BY_POLICY[connection.arrivalPolicy])}
      >
        <ArrivalsSection
          connectionState={connection.state}
          canManage={canManage}
          policy={connection.arrivalPolicy}
          decided={facts.arrivalsDecided}
          saving={setArrivals.isPending}
          refusal={setArrivals.error}
          onSave={saveArrivals}
        />
      </SetupStep>

      <SetupStep
        number={6}
        title="Turn it on"
        state={progress.goLive}
        note={progress.goLiveBlockedBecause ?? void 0}
        last
      >
        <GoLiveSection
          {...facts}
          canManage={canManage}
          activating={activate.isPending}
          settling={activationAccepted}
          refusal={activate.error}
          onActivate={goLive}
        />
      </SetupStep>
    </SetupSteps>
  );
}

/**
 * The way back in, with its two reads where they are read. The candidates are
 * `sso:manage` and the grants are `sso:view`, so a reader who may only look
 * still sees who can get in and is asked nothing about who could be.
 */
function BreakGlassStep({
  organizationId,
  canManage,
  onChanged,
}: {
  organizationId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const host = useSsoHost();
  const utils = ssoApi.useUtils();
  const grants = ssoApi.ssoSetup.breakGlassBindings.useQuery({ organizationId });
  const candidates = ssoApi.ssoSetup.breakGlassCandidates.useQuery(
    { organizationId },
    { enabled: canManage },
  );
  const grant = ssoApi.ssoSetup.grantBreakGlass.useMutation();
  const renew = ssoApi.ssoSetup.renewBreakGlass.useMutation();
  const revoke = ssoApi.ssoSetup.revokeBreakGlass.useMutation();
  // Which row is waiting, so only that row reads as busy.
  const [settlingBindingId, setSettlingBindingId] = useState<string | null>(null);

  const settled = (title: string) => ({
    onSuccess: () => {
      setSettlingBindingId(null);
      void utils.ssoSetup.breakGlassBindings.invalidate();
      // The grant is one of going live's preconditions, so the step above
      // it stops saying what is outstanding in the same breath.
      onChanged();
      host.succeeded({ title });
    },
    onError: (error: unknown) => {
      setSettlingBindingId(null);
      host.failed({ error, fallbackTitle: title });
    },
  });

  return (
    <BreakGlassSection
      canManage={canManage}
      grants={grants.data ?? []}
      candidates={candidates.data ?? []}
      granting={grant.isPending}
      settlingBindingId={settlingBindingId}
      onGrant={(command) =>
        grant.mutate({ organizationId, ...command }, settled("Granting a way back in"))
      }
      onRenew={(command) => {
        setSettlingBindingId(command.bindingId);
        renew.mutate({ organizationId, ...command }, settled("Extending a way back in"));
      }}
      onRevoke={(command) => {
        setSettlingBindingId(command.bindingId);
        revoke.mutate({ organizationId, ...command }, settled("Ending a way back in"));
      }}
    />
  );
}
