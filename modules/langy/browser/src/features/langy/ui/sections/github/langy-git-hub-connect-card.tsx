import { useRouter } from "@langwatch/browser-host/use-router";
/**
 * In-chat "Install the LangWatch GitHub App" card. Rendered by LangySidebar when the
 * assistant needs GitHub access it doesn't have yet, or proactively in onboarding.
 * Spec: modules/integration/specs/github-connection.feature.
 */
import { Box, Button, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { type ReactNode, useState } from "react";
import { FolderPlus, GitHub } from "react-feather";

import { api } from "../../../../../behavior/langy-api.ts";
import { useLangyHost } from "../../../../../model/langy-host.ts";
import { useGitHubConnectPopup } from "../../../behavior/github-connect-popup.ts";

// The in-app Integrations page — the SAME GitHub App flow the rest of the app
// opens (Settings → Integrations), reachable without a popup.
const GITHUB_SETTINGS_PATH = "/settings/integrations#github";

/** The self-hosting guide for registering the GitHub App Langy opens pull requests with. */
const GITHUB_APP_SETUP_DOCS = "https://docs.langwatch.ai/self-hosting/langy/github-app";

export type LangyGitHubConnectCardProps = {
  organizationId: string;
  /** Optional copy override — e.g. include the repo name the user mentioned. */
  headline?: string;
  /** Called after a successful install with the installed account login. */
  onConnected?: (login: string) => void;
  /** Ask for code access again, where a local folder can be shared. Absent = not offered. */
  onShareLocalFolder?: () => void;
};

export function LangyGitHubConnectCard({
  organizationId,
  headline = "Install the LangWatch GitHub App to open this PR",
  onConnected,
  onShareLocalFolder,
}: LangyGitHubConnectCardProps) {
  const status = api.github.getConnectionStatus.useQuery(
    { organizationId },
    { enabled: !!organizationId },
  );
  // Until the status answers, neither card: offering the install first would flash it.
  if (status.isLoading) return null;
  if (status.data?.configured === false) {
    return <LangyGitHubNotSetUpCard onShareLocalFolder={onShareLocalFolder} />;
  }
  return (
    <InstallGitHubApp
      organizationId={organizationId}
      headline={headline}
      onConnected={onConnected}
    />
  );
}

/** The instance has no GitHub App, so there is nothing to install: the local folder is the way. */
export function LangyGitHubNotSetUpCard({
  onShareLocalFolder,
}: {
  onShareLocalFolder?: (() => void) | undefined;
}) {
  // Registering the App is an instance setup step, so only an organization admin gets the guide.
  const isAdmin = useLangyHost().hasOrganizationPermission("organization:manage");
  return (
    <CardFrame>
      <HStack gap={2}>
        <GitHub size={16} />
        <Text textStyle="sm" fontWeight="640" color="fg">
          GitHub is not set up on this instance
        </Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        Share a local folder and Langy works in it with your own git and GitHub login. An
        administrator can also set up the GitHub App for this instance.
      </Text>
      {onShareLocalFolder ? (
        <Button
          size="sm"
          onClick={onShareLocalFolder}
          alignSelf="flex-start"
          background="fg"
          color="bg"
          _hover={{ background: "fg.muted" }}
        >
          <FolderPlus size={14} />
          Share local folder
        </Button>
      ) : null}
      {isAdmin ? (
        <chakra.a
          href={GITHUB_APP_SETUP_DOCS}
          target="_blank"
          rel="noreferrer"
          alignSelf="flex-start"
          textStyle="xs"
          color="fg.muted"
          textDecoration="underline"
          textUnderlineOffset="2px"
          _hover={{ color: "fg" }}
        >
          How to set up the GitHub App
        </chakra.a>
      ) : null}
    </CardFrame>
  );
}

function CardFrame({ children }: { children: ReactNode }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      maxWidth="420px"
      background="bg.subtle"
    >
      <VStack align="stretch" gap={2}>
        {children}
      </VStack>
    </Box>
  );
}

function InstallGitHubApp({
  organizationId,
  headline,
  onConnected,
}: Required<Pick<LangyGitHubConnectCardProps, "organizationId" | "headline">> &
  Pick<LangyGitHubConnectCardProps, "onConnected">) {
  const popup = useGitHubConnectPopup();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    setPopupBlocked(false);
    const result = await popup.connect(organizationId);
    setBusy(false);
    if (result.ok) {
      onConnected?.(result.login);
      return;
    }
    // A cancelled attempt is a non-event — the user closed the window. A blocked
    // popup isn't an error either: offer the full-page route into the same
    // integration flow. Only a genuine failure shows a message.
    if (result.reason === "cancelled") return;
    if (result.reason === "popup-blocked") {
      setPopupBlocked(true);
      return;
    }
    setError(result.error);
  };

  const openSettings = () => {
    void router.push(GITHUB_SETTINGS_PATH);
  };

  return (
    <CardFrame>
      <HStack gap={2}>
        <GitHub size={16} />
        <Text textStyle="sm" fontWeight="640" color="fg">
          {headline}
        </Text>
      </HStack>
      <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
        Langy opens pull requests on the repositories you choose, using short-lived tokens.
      </Text>
      <Button
        size="sm"
        onClick={onClick}
        loading={busy}
        alignSelf="flex-start"
        background="fg"
        color="bg"
        _hover={{ background: "fg.muted" }}
      >
        Install GitHub App
      </Button>
      {popupBlocked ? (
        <Text textStyle="xs" color="fg.muted">
          Your browser blocked the popup.{" "}
          <chakra.button
            type="button"
            onClick={openSettings}
            display="inline"
            color="orange.fg"
            textDecoration="underline"
            cursor="pointer"
          >
            Install from settings
          </chakra.button>{" "}
          instead.
        </Text>
      ) : null}
      {error ? (
        <Text textStyle="xs" color="red.fg">
          {error}
        </Text>
      ) : null}
    </CardFrame>
  );
}
