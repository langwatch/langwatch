// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * An organization's own single sign-on setup: one read, and the steps that
 * move it. A step whose command identity does not answer yet is not mounted —
 * a control that cannot do anything reads as a broken one (handoff §10).
 */
import { Skeleton, Text, VStack } from "@chakra-ui/react";
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { useEffect, useState } from "react";

import { ssoApi } from "../../behavior/sso-api.ts";
import { arrivalAnswerLabel, SSO_ANSWER_BY_POLICY } from "../../model/arrivals.ts";
import { setupProgressFor } from "../../model/setup-progress.ts";
import { domainClaimsOf, domainEvidenceOf, provesWithLicense } from "../../model/setup-view.ts";
import { useSsoHost } from "../../model/sso-host.ts";
import { LegacyRouteNotice } from "../elements/legacy-route-notice.tsx";
import { SetupStep, SetupSteps } from "../elements/setup-step.tsx";
import { ArrivalsSection } from "./arrivals.section.tsx";
import {
  ConnectionRemovalSection,
  type ConnectionRemovalCommand,
} from "./connection-removal.section.tsx";
import { DomainsSection } from "./domains.section.tsx";
import { HistorySection } from "./history.section.tsx";
import { ServiceProviderSection } from "./service-provider.section.tsx";
import { TestSignInSection } from "./test-sign-in.section.tsx";

type SetupConnection = NonNullable<SsoSetupPageView["connection"]>;

export default function SsoSetupScreen() {
  const organizationId = useSsoHost().organizationId();

  if (!organizationId) return null;

  return <SsoSetupPage organizationId={organizationId} />;
}

function SsoSetupPage({ organizationId }: { organizationId: string }) {
  const setup = ssoApi.ssoSetup.getSetup.useQuery({ organizationId });

  if (setup.isLoading) return <Skeleton height="220px" width="full" />;

  // A read that failed is not an organization without single sign-on: the
  // journey's first step would invite somebody to register a second provider.
  if (setup.isError || !setup.data) {
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
      <UnregisteredJourney />
    );
  }

  return (
    <ConnectedJourney organizationId={organizationId} view={view} connection={view.connection} />
  );
}

/** Registering is `ssoSetup.register` and has no form on this page yet. */
function UnregisteredJourney() {
  return (
    <VStack align="stretch" gap={6} width="full" data-testid="sso-setup">
      <SetupSteps>
        <SetupStep number={1} title="Connect your identity provider" state="current" last>
          <Text color="fg.muted" fontSize="sm">
            No identity provider is registered for this organization yet.
          </Text>
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
  const setArrivals = ssoApi.ssoSetup.setArrivals.useMutation();
  const discard = ssoApi.ssoSetup.discardConnection.useMutation();
  const remove = ssoApi.ssoSetup.removeConnection.useMutation();
  // Set between a removal being accepted and the read catching up, so the
  // danger zone says the press landed rather than looking like it did nothing.
  const [removalAccepted, setRemovalAccepted] = useState(false);
  const connectionId = connection.connectionId;
  const goLive = view.goLive;

  useEffect(() => {
    setRemovalAccepted(false);
  }, [connection.state, connection.tearDownAfterMs]);

  const refresh = () => {
    void utils.ssoSetup.getSetup.invalidate();
  };

  const progress = setupProgressFor({
    domainProved: goLive?.domainProved ?? false,
    testSignInDone: goLive?.testSignIn.done ?? false,
    breakGlassInPlace: goLive?.breakGlass.inPlace ?? false,
    arrivalsDecided: goLive?.arrivalsDecided ?? false,
    activated: goLive?.activated ?? false,
  });

  const saveArrivals = (policy: SetupConnection["arrivalPolicy"]) => {
    setArrivals.mutate(
      { organizationId, connectionId, policy },
      {
        onSuccess: refresh,
        onError: (error) => host.failed({ error, fallbackTitle: "Saving who gets in" }),
      },
    );
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

      <SetupSteps>
        <SetupStep
          number={1}
          title="Your identity provider"
          state={progress.provider}
          summary={connection.providerId}
        >
          <ServiceProviderSection
            protocol={connection.type}
            addresses={view.serviceProvider}
            connected
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
            organizationId={organizationId}
            connectionId={connectionId}
            canManage={canManage}
            provesWithLicense={provesWithLicense({ connection, record: view.record })}
            evidence={domainEvidenceOf(connection)}
            claims={domainClaimsOf(view.claims)}
            onChanged={refresh}
          />
        </SetupStep>

        <SetupStep number={3} title="Sign in through it once" state={progress.testSignIn}>
          <TestSignInSection
            connectionId={connectionId}
            providerName={connection.providerId}
            canManage={canManage}
            testSignIn={{ done: goLive?.testSignIn.done ?? false, atMs: null }}
            connectionState={connection.state}
            verifiedDomains={connection.verifiedDomains}
          />
        </SetupStep>

        {/* Upstream's steps four and six — a way back in, and turning it on —
            wait on identity's break-glass and activate commands. */}
        <SetupStep
          number={4}
          title="Say who it lets in"
          state={progress.arrivals}
          summary={arrivalAnswerLabel(SSO_ANSWER_BY_POLICY[connection.arrivalPolicy])}
          last
        >
          <ArrivalsSection
            connectionState={connection.state}
            canManage={canManage}
            policy={connection.arrivalPolicy}
            decided={goLive?.arrivalsDecided ?? false}
            saving={setArrivals.isPending}
            onSave={saveArrivals}
          />
        </SetupStep>
      </SetupSteps>

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
