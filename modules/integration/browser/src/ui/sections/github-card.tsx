/**
 * The GitHub card: connect the app, see the accounts it reaches, disconnect.
 * Reads github through `GithubHostApi` and a client from github's contract.
 * Spec: specs/integrations/github-connection.feature.
 */

import { Badge, Button, Card, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { LangyCodeAccessPreference } from "@langwatch/langy-browser-kit";
import { useState } from "react";
import { GitHub } from "react-feather";

import { githubApi } from "../../behavior/github-api.ts";
import { useGithubHost } from "../../model/github-host.ts";
import { githubInstallAddress } from "../../model/github-install-address.ts";
import { GithubInstallationRow } from "../elements/github-installation-row.tsx";

export function GithubCard({ organizationId }: { organizationId: string }) {
  const host = useGithubHost();
  const status = githubApi.github.getConnectionStatus.useQuery({ organizationId });

  const [uninstallStartedFor, setUninstallStartedFor] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const disconnect = githubApi.github.disconnect.useMutation({
    // The row that finished is read off the mutation's own VARIABLES, not off
    // the pending-row state beside it: that state is written in the same event
    // handler that starts the mutation, so the handler's closure would still
    // hold the value it had before the click.
    onSuccess: (_data, variables) => {
      // We can't uninstall via the API - open GitHub's uninstall page. The
      // webhook removes the local record once GitHub confirms.
      host.openExternal(_data.uninstallUrl);
      setUninstallStartedFor(variables.installationId);
      setDisconnectingId(null);
      void status.refetch();
    },
    onError: (error: unknown) => {
      setDisconnectingId(null);
      host.failed({ error, fallbackTitle: "Could not disconnect GitHub" });
    },
  });

  const installAddress = githubInstallAddress(status.data?.installUrl);
  const configured = status.data?.configured ?? true;
  const installations = status.data?.installations ?? [];

  const onInstall = () => {
    if (!installAddress) return;
    host.leaveTo(installAddress);
  };

  const showConnect = configured && installations.length === 0;
  const showInstallations = configured && installations.length > 0;

  return (
    <Card.Root id="github" data-testid="github-connection-card">
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <HStack gap={2}>
            <GitHub size={18} />
            <Heading size="sm">GitHub</Heading>
            {installations.length > 0 ? (
              <Badge colorPalette="green" variant="subtle">
                Installed
              </Badge>
            ) : null}
          </HStack>
          <Text fontSize="sm" color="fg.muted">
            Lets LangWatch open pull requests on the repositories you choose, and link coding agent
            sessions to the pull requests they produced. Pull requests are made by the LangWatch app
            and credit you as the requester.
          </Text>

          {!configured && (
            <Text fontSize="sm" color="fg.muted" data-testid="github-not-configured">
              The GitHub integration is not available on this instance.
            </Text>
          )}
          {showConnect && (
            <Button
              data-testid="github-connect"
              variant="solid"
              onClick={onInstall}
              disabled={!installAddress}
              alignSelf="flex-start"
            >
              Connect GitHub
            </Button>
          )}
          {showInstallations && (
            <VStack align="stretch" gap={3}>
              {installations.map((installation) => (
                <GithubInstallationRow
                  key={installation.installationId}
                  installation={installation}
                  disconnecting={
                    disconnect.isPending && disconnectingId === installation.installationId
                  }
                  uninstallStarted={uninstallStartedFor === installation.installationId}
                  onDisconnect={(installationId) => {
                    setDisconnectingId(installationId);
                    disconnect.mutate({ organizationId, installationId });
                  }}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={onInstall}
                disabled={!installAddress}
                alignSelf="flex-start"
              >
                Add another account
              </Button>
            </VStack>
          )}

          {/* How Langy reaches this person's code, once they chose (ADR-129). */}
          <LangyCodeAccessPreference />
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
