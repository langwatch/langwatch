/**
 * Settings → Integrations. The organization's GitHub connection: connect the
 * app, see which GitHub accounts and repositories it reaches, and open GitHub
 * to change or remove the installation. Future integrations slot in here as
 * additional cards.
 *
 * `platform/app/src/pages/settings/integrations.tsx`, moved whole. What changed
 * is only what a feature-web package may not own:
 *
 * - `SettingsLayout` does not travel. Chrome belongs to the route tree, and
 *   `apps/ui` mounts the harvested settings layout around this screen.
 * - `withPermissionGuard("organization:manage")` does not travel either; the
 *   frontend feature states the same policy in front of the same loader.
 * - The organization, the address, the toast and BOTH DEPARTURES to github.com
 *   are the host's. `window.location.href` and `window.open` are the two the
 *   page called directly, and a screen may call neither.
 * - The local seven-field `Installation` type is gone. It restated
 *   `GithubInstallationSummary`, which the procedure already answers with.
 *
 * WHAT DID NOT SURVIVE THE MOVE, named rather than quietly dropped: the page
 * rendered a bare `<SettingsLayout />` while the organization was still
 * arriving, so the menu appeared before the card did. The frontend feature
 * mounts the same chrome unconditionally now, so this screen renders its own
 * loading state inside it instead — the same frame, one fewer flash.
 *
 * Spec: specs/integrations/github-connection.feature
 */

import { Badge, Button, Card, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { GitHub } from "react-feather";
import { githubApi } from "../../behavior/github-api";
import { GITHUB_ERROR_QUERY_KEY, githubInstallAddress } from "../../model/github-install-address";
import { useGithubHost } from "../../model/github-host";
import { GithubInstallationRow } from "../../ui/elements/github-installation-row";

/** The grant the platform page asked for, unchanged. */
export const INTEGRATIONS_PAGE_PERMISSION = "organization:manage";

export default function IntegrationsScreen() {
  const host = useGithubHost();
  const organizationId = host.scope().organizationId;

  return (
    <VStack align="stretch" gap={6} padding={6} maxWidth="720px">
      <Heading size="md">Integrations</Heading>
      {organizationId ? (
        <GithubConnectionCard organizationId={organizationId} />
      ) : (
        <Spinner data-testid="integrations-loading" />
      )}
    </VStack>
  );
}

function GithubConnectionCard({ organizationId }: { organizationId: string }) {
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
      // We can't uninstall via the API — open GitHub's uninstall page. The
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

  const reportedError = host.route().query[GITHUB_ERROR_QUERY_KEY];
  useEffect(() => {
    if (typeof reportedError !== "string" || reportedError.length === 0) return;

    host.failed({
      error: void 0,
      fallbackTitle: "GitHub installation failed",
      description: reportedError,
    });
    // Reported once. Left in the address it would be reported again on every
    // reload, which is the platform page's own reason for dropping it here.
    host.setQuery({ [GITHUB_ERROR_QUERY_KEY]: void 0 }, { replace: true });
    // Keyed only on the error value: the host is rebuilt whenever the address
    // changes, so depending on it would re-run this on the write above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportedError]);

  const installAddress = githubInstallAddress(status.data?.installUrl);
  const configured = status.data?.configured ?? true;
  const installations = status.data?.installations ?? [];

  const onInstall = () => {
    if (!installAddress) return;
    host.leaveTo(installAddress);
  };

  return (
    <Card.Root id="github">
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

          {!configured ? (
            <Text fontSize="sm" color="fg.muted">
              The GitHub integration is not available on this instance.
            </Text>
          ) : installations.length === 0 ? (
            <Button
              variant="solid"
              onClick={onInstall}
              disabled={!installAddress}
              alignSelf="flex-start"
            >
              Connect GitHub
            </Button>
          ) : (
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
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
