/**
 * Settings → Integrations. Two cards today, at two different scopes:
 *
 *  - GitHub, owned by the organization: connect the app, see which GitHub
 *    accounts and repositories it reaches, and open GitHub to change or remove
 *    the installation. Managing it takes `organization:manage`.
 *  - Slack, owned by a project (ADR-093 §5): one bot token per project,
 *    rotated in one place, so no automation has to carry its own. Managing it
 *    takes `project:update` at the picked project.
 *
 * The page itself therefore guards on `organization:view` — the permission
 * every member of the organization holds — and each card gates its own writes.
 * Guarding the page on `organization:manage`, as it did while GitHub was the
 * only card, would have hidden a project-scoped integration from exactly the
 * people who own it: a project admin who is not an organization admin.
 *
 * The same GitHub install endpoint serves the in-chat popup flow; this page
 * uses the redirect-mode variant so a full-page round-trip lands back here.
 *
 * Specs: specs/integrations/github-connection.feature,
 * specs/automations/source-merge.feature.
 */
import {
  Badge,
  Box,
  Button,
  Card,
  Code,
  Field,
  Heading,
  HStack,
  Input,
  Link,
  List,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { GitHub } from "react-feather";
import { FaSlack } from "react-icons/fa";
import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { ScopeChipPicker } from "~/components/settings/ScopeChipPicker";
import { confirmSwitchAllToProjectIntegration } from "~/features/automations/logic/slackLegacyTokenCopy";
import { SLACK_APP_MANIFEST } from "~/features/automations/providers/slack/slackAppManifest";
import { describeError } from "~/features/errors";
import { useAvailableScopes } from "~/hooks/useAvailableScopes";
import { useRouter } from "~/utils/compat/next-router";

import SettingsLayout from "../../components/SettingsLayout";
import { toaster } from "../../components/ui/toaster";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function IntegrationsSettings() {
  const { organization } = useOrganizationTeamProject();
  if (!organization) return <SettingsLayout />;
  return <IntegrationsContent organizationId={organization.id} />;
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(IntegrationsSettings);

function IntegrationsContent({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useOrganizationTeamProject();
  const canManageOrganization = hasPermission("organization:manage");
  const status = api.github.getConnectionStatus.useQuery(
    { organizationId },
    { enabled: canManageOrganization },
  );
  const router = useRouter();

  useEffect(() => {
    const githubError = router.query.githubError;
    if (typeof githubError !== "string") return;

    toaster.create({
      type: "error",
      title: "GitHub installation failed",
      description: githubError,
    });

    const { githubError: _drop, ...rest } = router.query;
    void router.replace({ pathname: router.pathname, query: rest }, undefined, {
      shallow: true,
      scroll: false,
    });
    // Intentionally keyed only on the error value, not the whole router object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.query.githubError]);

  // The server hands back the install entry point, so the App slug and the
  // shape of the flow stay off the client.
  const installUrl = status.data?.installUrl;

  const onInstall = () => {
    if (!installUrl) return;
    const ret = encodeURIComponent("/settings/integrations#github");
    window.location.href = `${installUrl}&mode=redirect&return=${ret}`;
  };

  const configured = status.data?.configured ?? true;
  const installations = status.data?.installations ?? [];

  return (
    <SettingsLayout>
      <VStack align="stretch" gap={6} padding={6} maxWidth="720px">
        <Heading size="md">Integrations</Heading>
        <SlackIntegrationCard />
        {!canManageOrganization ? null : (
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
                  Lets LangWatch open pull requests on the repositories you
                  choose, and link coding agent sessions to the pull requests
                  they produced. Pull requests are made by the LangWatch app and
                  credit you as the requester.
                </Text>

                {!configured ? (
                  <Text fontSize="sm" color="fg.muted">
                    The GitHub integration is not available on this instance.
                  </Text>
                ) : installations.length === 0 ? (
                  <Button
                    variant="solid"
                    onClick={onInstall}
                    disabled={!installUrl}
                    alignSelf="flex-start"
                  >
                    Connect GitHub
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
                      disabled={!installUrl}
                      alignSelf="flex-start"
                    >
                      Add another account
                    </Button>
                  </VStack>
                )}
              </VStack>
            </Card.Body>
          </Card.Root>
        )}
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
  const disconnect = api.github.disconnect.useMutation({
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
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
    >
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
              Finish uninstalling on GitHub — this updates once GitHub confirms.
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

/**
 * The project's Slack connection (ADR-093 §5). One bot token per project,
 * pasted once and rotated here, so no automation has to carry its own.
 *
 * The project is picked with `ScopeChipPicker` (`allowedScopeTypes={["PROJECT"]}`,
 * `singleSelect`) per dev/docs/best_practices/scope-selector-and-badges.md — the
 * card is scoped, and a scoped surface never hand-rolls its selector. The
 * server re-checks `project:update` on every write regardless of what the
 * picker offers.
 */
function SlackIntegrationCard() {
  const { organization, project } = useOrganizationTeamProject();
  const available = useAvailableScopes(organization);
  const availableProjects = useMemo(
    () =>
      available.projects.map(({ id, name, teamId }) => ({
        id,
        name,
        teamId: teamId ?? undefined,
      })),
    [available.projects],
  );
  const [scopes, setScopes] = useState<
    Array<{ scopeType: "PROJECT"; scopeId: string }>
  >(project ? [{ scopeType: "PROJECT", scopeId: project.id }] : []);
  const selectedProjectId = scopes[0]?.scopeId ?? "";
  const selectedProjectName = useMemo(
    () =>
      availableProjects.find((candidate) => candidate.id === selectedProjectId)
        ?.name ?? null,
    [availableProjects, selectedProjectId],
  );

  return (
    <Card.Root id="slack">
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <HStack gap={2}>
            <FaSlack size={18} />
            <Heading size="sm">Slack</Heading>
          </HStack>
          <Text fontSize="sm" color="fg.muted">
            Connect a Slack workspace to a project so its automations can post
            to a channel. The token is stored once and rotated here, and no
            automation needs one of its own.
          </Text>
          <ScopeChipPicker<"PROJECT">
            value={scopes}
            onChange={setScopes}
            organizationId={organization?.id}
            organizationName={organization?.name}
            projectId={project?.id}
            projectName={project?.name}
            availableProjects={availableProjects}
            allowedScopeTypes={["PROJECT"]}
            singleSelect
            label="Project"
          />
          {selectedProjectId ? (
            <SlackProjectConnection
              projectId={selectedProjectId}
              projectName={selectedProjectName}
            />
          ) : (
            <Text fontSize="sm" color="fg.muted">
              Pick a project to see its Slack connection.
            </Text>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** Connection state, the paste-a-token form, and the legacy-token census for
 *  one project. Setup and rotation are the same form because they are the same
 *  write: Slack revalidates the token and the ciphertext is replaced. */
function SlackProjectConnection({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string | null;
}) {
  const utils = api.useContext();
  const status = api.slackIntegration.getStatus.useQuery({ projectId });
  // Per SELECTED project, answered by the server with the status read — the
  // picker can reach projects the session is not on, where the session
  // project's permission would show write controls that only invite a 403.
  const canManage = status.data?.canManage ?? false;
  const census = api.slackIntegration.getLegacyTokenCensus.useQuery({
    projectId,
  });

  const refresh = () => {
    void utils.slackIntegration.getStatus.invalidate({ projectId });
    void utils.slackIntegration.getLegacyTokenCensus.invalidate({ projectId });
  };

  const connected = status.data?.connected ?? false;

  return (
    <VStack align="stretch" gap={3} data-testid="slack-project-connection">
      <HStack gap={2}>
        {connected ? (
          <>
            <Badge colorPalette="green" variant="subtle">
              Connected
            </Badge>
            <Text fontSize="sm">{status.data?.slackTeamName}</Text>
          </>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            Not connected.
          </Text>
        )}
      </HStack>
      <SlackLegacyTokenCensus
        projectId={projectId}
        count={census.data?.count ?? 0}
        canSwitch={connected && canManage}
        workspaceName={status.data?.slackTeamName ?? null}
        onSwitched={refresh}
      />
      <SlackTokenForm
        projectId={projectId}
        projectName={projectName}
        connected={connected}
        canManage={canManage}
        onChanged={refresh}
      />
    </VStack>
  );
}

/**
 * How many automations in the project still carry their own Slack token, and
 * the one action that moves them (ADR-093 §5). The count is the migration's
 * progress meter: most-specific-first means rotating the project token does not
 * reach those rows, so the answer is to keep saying so until the count is zero.
 * Each row switches independently, and the result names how many moved and how
 * many did not.
 */
function SlackLegacyTokenCensus({
  projectId,
  count,
  canSwitch,
  workspaceName,
  onSwitched,
}: {
  projectId: string;
  count: number;
  canSwitch: boolean;
  workspaceName: string | null;
  onSwitched: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const switchAll = api.slackIntegration.switchToIntegration.useMutation({
    onSuccess: ({ cleared, alreadyClear, failed }) => {
      setConfirming(false);
      onSwitched();
      // A row that already carried no token is where the switch was taking
      // it, so it reads as switched rather than failed.
      const switched = cleared + alreadyClear;
      toaster.create({
        type: failed > 0 ? "warning" : "success",
        title:
          failed > 0
            ? `${switched} switched, ${failed} failed`
            : `${switched} switched to the project integration`,
        description:
          failed > 0
            ? "The ones that failed still post with their own token. Try again, or open them to check."
            : undefined,
      });
    },
    onError: (error) =>
      toaster.create({
        type: "error",
        title: "Couldn't switch those automations",
        description: describeError({
          error,
          fallbackTitle: "Couldn't switch those automations",
        }),
      }),
  });

  const confirmation = confirmSwitchAllToProjectIntegration({
    count,
    workspaceName,
  });

  if (count === 0) return null;

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      padding={3}
    >
      <VStack align="stretch" gap={2}>
        <Text fontSize="sm">
          {count === 1
            ? "1 automation in this project still uses its own Slack token."
            : `${count} automations in this project still use their own Slack token.`}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          They keep posting with the token saved on them, so rotating here does
          not reach them until they switch.
        </Text>
        {canSwitch ? (
          <Button
            size="xs"
            variant="outline"
            alignSelf="flex-start"
            loading={switchAll.isPending}
            onClick={() => setConfirming(true)}
          >
            Use the project integration
          </Button>
        ) : null}
      </VStack>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        tone="danger"
        loading={switchAll.isPending}
        onConfirm={() => switchAll.mutate({ projectId })}
      />
    </Box>
  );
}

/** Paste a bot token to connect, or paste a new one to rotate — the same form
 *  and the same write, because Slack revalidates either way and the ciphertext
 *  is replaced either way. */
function SlackTokenForm({
  projectId,
  projectName,
  connected,
  canManage,
  onChanged,
}: {
  projectId: string;
  projectName: string | null;
  connected: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [token, setToken] = useState("");
  const [showForm, setShowForm] = useState(false);

  const connect = api.slackIntegration.connect.useMutation({
    onSuccess: (integration) => {
      setToken("");
      setShowForm(false);
      onChanged();
      toaster.create({
        type: "success",
        title: "Slack connected",
        description: `${projectName ?? "This project"} posts to the ${
          integration.slackTeamName
        } workspace.`,
      });
    },
    onError: (error) =>
      toaster.create({
        type: "error",
        title: "Couldn't connect Slack",
        description: describeError({
          error,
          fallbackTitle: "Couldn't connect Slack",
        }),
      }),
  });

  const disconnect = api.slackIntegration.disconnect.useMutation({
    onSuccess: onChanged,
    onError: (error) =>
      toaster.create({
        type: "error",
        title: "Couldn't disconnect Slack",
        description: describeError({
          error,
          fallbackTitle: "Couldn't disconnect Slack",
        }),
      }),
  });

  if (!canManage) {
    return (
      <Text fontSize="xs" color="fg.muted">
        Ask a project administrator to change this project&rsquo;s Slack
        connection.
      </Text>
    );
  }

  if (connected && !showForm) {
    return (
      <HStack gap={2}>
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          Replace token
        </Button>
        <Button
          variant="outline"
          size="sm"
          loading={disconnect.isPending}
          onClick={() => disconnect.mutate({ projectId })}
        >
          Disconnect
        </Button>
      </HStack>
    );
  }

  return (
    <VStack align="stretch" gap={3}>
      <SlackAppSetupCallout />
      <Field.Root>
        <Field.Label>Bot User OAuth Token</Field.Label>
        <Input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="xoxb-…"
        />
      </Field.Root>
      <HStack gap={2}>
        <Button
          variant="solid"
          size="sm"
          disabled={token.trim().length === 0}
          loading={connect.isPending}
          onClick={() => connect.mutate({ projectId, botToken: token })}
        >
          {connected ? "Replace token" : "Connect Slack"}
        </Button>
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowForm(false);
              setToken("");
            }}
          >
            Cancel
          </Button>
        ) : null}
      </HStack>
    </VStack>
  );
}

/** Where to get a bot token. This guidance used to sit in the composer, once
 *  per automation; it belongs here now, once per project. */
function SlackAppSetupCallout() {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const copyManifest = () => {
    // "Manifest copied" only after the write lands — a denied clipboard must
    // not claim otherwise.
    navigator.clipboard
      ?.writeText(SLACK_APP_MANIFEST)
      .then(() => {
        setCopied(true);
        copyResetTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() =>
        toaster.create({
          type: "error",
          title: "Couldn't copy the manifest",
          description: "Select the manifest text and copy it manually.",
        }),
      );
  };

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      padding={3}
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={3}>
          <Link
            href="https://api.slack.com/apps"
            target="_blank"
            rel="noopener noreferrer"
            fontSize="xs"
            fontWeight="medium"
          >
            Create a Slack app
          </Link>
          <Button
            variant="plain"
            size="xs"
            height="auto"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            onClick={copyManifest}
          >
            {copied ? "Manifest copied" : "Copy app manifest"}
          </Button>
          <Button
            variant="plain"
            size="xs"
            height="auto"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            onClick={() => setStepsOpen((previous) => !previous)}
          >
            {stepsOpen ? "Hide the steps" : "Where do I get a bot token?"}
          </Button>
        </HStack>
        {stepsOpen ? (
          <List.Root as="ol" gap={1} paddingLeft={4}>
            <List.Item>
              <Text fontSize="xs" color="fg.muted">
                Create the app with &ldquo;From a manifest,&rdquo; choose the
                YAML format, and paste the copied manifest — it sets the
                permissions for you.
              </Text>
            </List.Item>
            <List.Item>
              <Text fontSize="xs" color="fg.muted">
                Install it to your workspace and copy the Bot User OAuth Token (
                <Code size="sm">xoxb-</Code>).
              </Text>
            </List.Item>
            <List.Item>
              <Text fontSize="xs" color="fg.muted">
                Public channels work straight away. To post to a private
                channel, add the app to that channel first.
              </Text>
            </List.Item>
          </List.Root>
        ) : null}
      </VStack>
    </Box>
  );
}
