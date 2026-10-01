/**
 * Settings, Connect: which LangWatch-hosted services this install may call.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { Link } from "@langwatch/browser-host/link";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert, Button, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { CloudOff, KeyRound } from "lucide-react";

import { connectApi } from "../../behavior/connect-api.ts";
import { useLicensingHost } from "../../model/licensing-host.ts";
import { ConnectServicesSection } from "./connect-services-section.tsx";
import { ConnectSpendSection } from "./connect-spend-section.tsx";
import type { ConnectEnabledStatus } from "./connect-status.ts";
import { ConnectSyncSection } from "./connect-sync-section.tsx";

export default function ConnectScreen() {
  const organizationId = useLicensingHost().organizationId();
  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Connect</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">
          Which LangWatch-hosted services this install may call, what they send and what they cost.
        </Text>
        {organizationId ? <ConnectStatusPanel organizationId={organizationId} /> : null}
      </VStack>
    </>
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
      <Alert.Root status="error" data-testid="connect-load-error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>
            {host.describeFailure({
              error: status.error,
              fallbackTitle: "Couldn't load hosted services",
            })}
          </Alert.Title>
        </Alert.Content>
      </Alert.Root>
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
    <VStack width="full" align="stretch" gap={6}>
      {refusal ? (
        <Alert.Root status="error" data-testid="connect-refusal">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {host.describeFailure({
                error: { error: { code: refusal.code, meta: refusal.meta } },
                fallbackTitle: "Hosted services are refusing this install",
              })}
            </Alert.Title>
          </Alert.Content>
        </Alert.Root>
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
    <NoDataInfoBlock
      testId="connect-deployment-off"
      icon={<CloudOff />}
      title="Hosted services are switched off for this deployment"
      description="Nothing is sent to LangWatch from this install. To use hosted services here, remove app.connect.disabled from your Helm values, or unset LANGWATCH_CONNECT_DISABLED in the environment, then restart LangWatch. What this install may call is then decided by its license."
    />
  );
}

function NoLicense() {
  return (
    <NoDataInfoBlock
      testId="connect-no-license"
      icon={<KeyRound />}
      title="Hosted services need a license"
      description="Activate a license, then come back to choose which hosted services this install may call."
    >
      <Button asChild size="sm" variant="outline" colorPalette="orange">
        <Link unstyled href="/settings/license">
          Open the License page
        </Link>
      </Button>
    </NoDataInfoBlock>
  );
}
