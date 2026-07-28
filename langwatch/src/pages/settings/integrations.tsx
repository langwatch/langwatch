/**
 * Settings → Integrations. v0 surfaces the Langy ↔ GitHub App installation:
 * install the app, see which GitHub accounts and repositories Langy can reach,
 * and open GitHub to change or remove the installation. Future integrations
 * slot in here as additional cards.
 *
 * The same install endpoint serves the in-chat popup flow; this page uses the
 * redirect-mode variant so a full-page round-trip lands back here.
 *
 * Spec: specs/langy/langy-github-install.feature. Issue: #4747.
 */
import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Link,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { GitHub } from "react-feather";

import SettingsLayout from "../../components/SettingsLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function IntegrationsSettings() {
  const { organization } = useOrganizationTeamProject();
  if (!organization) return <SettingsLayout />;
  return <IntegrationsContent organizationId={organization.id} />;
}

export default withPermissionGuard("organization:manage", {
  layoutComponent: SettingsLayout,
})(IntegrationsSettings);

function IntegrationsContent({ organizationId }: { organizationId: string }) {
  const status = api.langyGithub.getInstallStatus.useQuery({ organizationId });

  const onInstall = () => {
    const ret = encodeURIComponent("/settings/integrations#github");
    window.location.href = `/api/github-langy/install?mode=redirect&organizationId=${encodeURIComponent(
      organizationId,
    )}&return=${ret}`;
  };

  const configured = status.data?.configured ?? true;
  const installations = status.data?.installations ?? [];

  return (
    <SettingsLayout>
      <VStack align="stretch" gap={6} padding={6} maxWidth="720px">
        <Heading size="md">Integrations</Heading>
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
                Lets Langy open pull requests on the repositories you choose.
                Pull requests are made by the LangWatch app and credit you as
                the requester.
              </Text>

              {!configured ? (
                <Text fontSize="sm" color="fg.muted">
                  The GitHub integration is not available on this instance.
                </Text>
              ) : installations.length === 0 ? (
                <Button
                  variant="solid"
                  onClick={onInstall}
                  alignSelf="flex-start"
                >
                  Install the LangWatch GitHub App
                </Button>
              ) : (
                <VStack align="stretch" gap={3}>
                  {installations.map((inst) => (
                    <InstallationRow
                      key={inst.installationId}
                      organizationId={organizationId}
                      installation={inst}
                      onChanged={() => void status.refetch()}
                    />
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onInstall}
                    alignSelf="flex-start"
                  >
                    Add another account
                  </Button>
                </VStack>
              )}
            </VStack>
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}

type Installation = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  repositoryCount: number | null;
  suspended: boolean;
  uninstallUrl: string;
};

function InstallationRow({
  organizationId,
  installation,
  onChanged,
}: {
  organizationId: string;
  installation: Installation;
  onChanged: () => void;
}) {
  // Uninstalling finishes on GitHub, and this row keeps saying "Installed"
  // until GitHub's confirmation lands — without a hint, that reads as the
  // Disconnect button doing nothing.
  const [uninstallStarted, setUninstallStarted] = useState(false);
  const disconnect = api.langyGithub.disconnect.useMutation({
    onSuccess: (data) => {
      // We can't uninstall via the API — open GitHub's uninstall page. The
      // webhook removes the local record once GitHub confirms.
      window.open(data.uninstallUrl, "_blank", "noopener,noreferrer");
      setUninstallStarted(true);
      onChanged();
    },
  });

  const repoSummary =
    installation.repositorySelection === "all"
      ? "All repositories"
      : `${installation.repositoryCount ?? 0} selected ${
          installation.repositoryCount === 1 ? "repository" : "repositories"
        }`;

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={3}>
      <HStack justify="space-between" gap={3}>
        <VStack align="stretch" gap={0}>
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="600">
              @{installation.accountLogin}
            </Text>
            {installation.suspended ? (
              <Badge colorPalette="orange" variant="subtle">
                Suspended
              </Badge>
            ) : null}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {repoSummary}
          </Text>
          {uninstallStarted ? (
            <Text fontSize="xs" color="fg.muted">
              Finish uninstalling on GitHub — this updates once GitHub
              confirms.
            </Text>
          ) : null}
        </VStack>
        <HStack gap={2}>
          <Link
            href={installation.uninstallUrl}
            target="_blank"
            rel="noopener noreferrer"
            fontSize="sm"
          >
            Configure
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              disconnect.mutate({
                organizationId,
                installationId: installation.installationId,
              })
            }
            loading={disconnect.isPending}
          >
            Disconnect
          </Button>
        </HStack>
      </HStack>
    </Box>
  );
}
