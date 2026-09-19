import { Link, Skeleton, Text, VStack } from "@chakra-ui/react";

import { SettingsSection } from "~/components/settings/SettingsSection";
import { HandledErrorAlert } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { ConnectServicesSection } from "./connect/ConnectServicesSection";
import { ConnectSpendSection } from "./connect/ConnectSpendSection";
import { ConnectSyncSection } from "./connect/ConnectSyncSection";
import type { ConnectEnabledView } from "./connect/connectStatus";

/**
 * Settings, Connect: which LangWatch-hosted services this install may call.
 *
 * Spec: specs/self-hosting/connected-services/connect-settings.feature
 */
export function ConnectSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { hasPermission } = useOrganizationTeamProject();
  const canManage = hasPermission("organization:manage");

  const {
    data: status,
    isLoading,
    error,
    refetch,
  } = api.connect.status.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  if (isLoading) {
    return <Skeleton height="120px" width="full" />;
  }

  if (error) {
    return (
      <HandledErrorAlert
        error={error}
        fallbackTitle="Couldn't load hosted services"
        dismissible={false}
      />
    );
  }

  if (!status) return null;

  if (status.deployment === "off") {
    return <DeploymentOff />;
  }

  if (!status.licensed) {
    return <NoLicense />;
  }

  return (
    <ConnectedOrganization
      organizationId={organizationId}
      status={status}
      canManage={canManage}
      onChanged={() => void refetch()}
    />
  );
}

function ConnectedOrganization({
  organizationId,
  status,
  canManage,
  onChanged,
}: {
  organizationId: string;
  status: ConnectEnabledView;
  canManage: boolean;
  onChanged: () => void;
}) {
  const refusal = status.refusal;

  return (
    <VStack width="full" align="stretch" gap={0}>
      {refusal ? (
        <HandledErrorAlert
          error={{ error: { code: refusal.code, meta: refusal.meta } }}
          dismissible={false}
        />
      ) : null}
      <ConnectServicesSection
        organizationId={organizationId}
        status={status}
        canManage={canManage}
        onChanged={onChanged}
      />
      <ConnectSpendSection
        organizationId={organizationId}
        status={status}
        canManage={canManage}
        onSaved={onChanged}
      />
      <ConnectSyncSection status={status} />
    </VStack>
  );
}

function DeploymentOff() {
  return (
    <SettingsSection
      title="Connect is switched off for this deployment"
      testId="connect-deployment-off"
    >
      <VStack width="full" align="start" gap={2}>
        <Text fontSize="sm" color="fg.muted">
          Nothing is sent to LangWatch from this install.
        </Text>
        <Text fontSize="sm" color="fg.muted">
          To offer hosted services here, set app.connect.enabled to true in your
          Helm values, or set LANGWATCH_CONNECT_ENABLED to true in the
          environment, then restart LangWatch. Every service still starts
          switched off until someone switches it on from this page.
        </Text>
      </VStack>
    </SettingsSection>
  );
}

function NoLicense() {
  return (
    <SettingsSection
      title="Hosted services need a license"
      testId="connect-no-license"
    >
      <Text fontSize="sm" color="fg.muted">
        Activate a license on the <Link href="/settings/license">License</Link>{" "}
        page, then come back to choose which hosted services this install may
        call.
      </Text>
    </SettingsSection>
  );
}
