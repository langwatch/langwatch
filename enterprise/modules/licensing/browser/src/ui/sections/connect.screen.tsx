/**
 * Settings, Connect: which LangWatch-hosted services this install may call.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { Heading, Link, Skeleton, Text, VStack } from "@chakra-ui/react";

import { connectApi } from "../../behavior/connect-api.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";
import { SettingsBlock } from "../elements/settings-block.tsx";
import { ConnectServicesSection } from "./connect-services-section.tsx";
import { ConnectSpendSection } from "./connect-spend-section.tsx";
import type { ConnectEnabledStatus } from "./connect-status.ts";
import { ConnectSyncSection } from "./connect-sync-section.tsx";

export default function ConnectScreen() {
  const organizationId = useLicensingHost().organizationId();
  return (
    <VStack gap={2} width="full" align="start">
      <Heading>Connect</Heading>
      {organizationId ? <ConnectStatusPanel organizationId={organizationId} /> : null}
    </VStack>
  );
}

function ConnectStatusPanel({ organizationId }: { organizationId: string }) {
  const host = useLicensingHost();
  const status = connectApi.connect.status.useQuery(
    { organizationId },
    { refetchOnWindowFocus: false },
  );

  if (status.isLoading) return <Skeleton height="120px" width="full" />;
  if (status.error) {
    return (
      <Text color="fg.error" data-testid="connect-load-error">
        {host.describeFailure({
          error: status.error,
          fallbackTitle: "Couldn't load hosted services",
        })}
      </Text>
    );
  }
  if (!status.data) return null;
  if (status.data.deployment === "off") return <DeploymentOff />;
  if (!status.data.licensed) return <NoLicense />;
  return (
    <ConnectedOrganization
      organizationId={organizationId}
      status={status.data}
      onChanged={() => void status.refetch()}
    />
  );
}

function ConnectedOrganization({
  organizationId,
  status,
  onChanged,
}: {
  organizationId: string;
  status: ConnectEnabledStatus;
  onChanged: () => void;
}) {
  const host = useLicensingHost();
  const refusal = status.refusal;
  return (
    <VStack width="full" align="stretch" gap={0}>
      {refusal ? (
        <Text color="fg.error" data-testid="connect-refusal">
          {host.describeFailure({
            error: { error: { code: refusal.code, meta: refusal.meta } },
            fallbackTitle: "Hosted services are refusing this install",
          })}
        </Text>
      ) : null}
      <ConnectServicesSection
        organizationId={organizationId}
        status={status}
        onChanged={onChanged}
      />
      <ConnectSpendSection organizationId={organizationId} status={status} onSaved={onChanged} />
      <ConnectSyncSection status={status} />
    </VStack>
  );
}

function DeploymentOff() {
  return (
    <SettingsBlock
      title="Hosted services are switched off for this deployment"
      testId="connect-deployment-off"
    >
      <Text fontSize="sm" color="fg.muted">
        Nothing is sent to LangWatch from this install.
      </Text>
      <Text fontSize="sm" color="fg.muted">
        To use hosted services here, remove app.connect.disabled from your Helm values, or unset
        LANGWATCH_CONNECT_DISABLED in the environment, then restart LangWatch. What this install may
        call is then decided by its license.
      </Text>
    </SettingsBlock>
  );
}

function NoLicense() {
  return (
    <SettingsBlock title="Hosted services need a license" testId="connect-no-license">
      <Text fontSize="sm" color="fg.muted">
        Activate a license on the <Link href="/settings/license">License</Link> page, then come back
        to choose which hosted services this install may call.
      </Text>
    </SettingsBlock>
  );
}
