/**
 * Settings → Integrations. v0 surfaces the Langy ↔ GitHub connection only;
 * future integrations slot in here as additional cards.
 *
 * The same OAuth endpoint serves the in-chat popup flow; this page uses the
 * redirect-mode variant so a user landing here from a "Connect GitHub in
 * settings" link gets a normal full-page round-trip.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
 */
import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
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
  const connection = api.langyGithub.getConnection.useQuery({ organizationId });
  const utils = api.useUtils();
  const disconnect = api.langyGithub.disconnect.useMutation({
    onSuccess: () => {
      void utils.langyGithub.getConnection.invalidate({ organizationId });
    },
  });

  const onConnect = () => {
    const ret = encodeURIComponent("/settings/integrations#github");
    window.location.href = `/api/github-langy/connect?mode=redirect&organizationId=${encodeURIComponent(
      organizationId,
    )}&return=${ret}`;
  };

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
                {connection.data ? (
                  <Badge colorPalette="green" variant="subtle">
                    Connected
                  </Badge>
                ) : null}
              </HStack>
              <Text fontSize="sm" color="gray.600">
                Lets Langy open pull requests on your behalf. PRs are authored
                by your GitHub user; LangWatch only stores a short-lived,
                rotating refresh token (encrypted at rest) and never your
                password.
              </Text>
              {connection.data ? (
                <Box>
                  <HStack gap={3}>
                    <Text fontSize="sm">
                      Connected as{" "}
                      <strong>@{connection.data.githubLogin}</strong>
                    </Text>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => disconnect.mutate({ organizationId })}
                      loading={disconnect.isPending}
                    >
                      Disconnect
                    </Button>
                  </HStack>
                </Box>
              ) : (
                <Button
                  variant="solid"
                  onClick={onConnect}
                  alignSelf="flex-start"
                >
                  Connect GitHub
                </Button>
              )}
            </VStack>
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}
