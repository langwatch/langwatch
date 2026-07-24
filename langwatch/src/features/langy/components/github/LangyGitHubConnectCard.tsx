/**
 * In-chat "Install the LangWatch GitHub App" card. Rendered by LangySidebar
 * when the assistant needs GitHub access it doesn't have yet, or proactively in
 * onboarding.
 *
 * Clicking the button opens the install popup; on success it resolves with the
 * installed account and the caller can refetch / replay the user's last prompt
 * so the conversation continues seamlessly.
 *
 * Spec: specs/langy/langy-github-install.feature. Issue: #4747.
 */
import { Box, Button, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { GitHub } from "react-feather";

import { useRouter } from "~/utils/compat/next-router";
import { useGitHubConnectPopup } from "./useGitHubConnectPopup";

// The in-app Integrations page — the SAME GitHub App flow the rest of the app
// opens (Settings → Integrations), reachable without a popup.
const GITHUB_SETTINGS_PATH = "/settings/integrations#github";

export type LangyGitHubConnectCardProps = {
  organizationId: string;
  /** Optional copy override — e.g. include the repo name the user mentioned. */
  headline?: string;
  /** Called after a successful install with the installed account login. */
  onConnected?: (login: string) => void;
};

export function LangyGitHubConnectCard({
  organizationId,
  headline = "Install the LangWatch GitHub App to open this PR",
  onConnected,
}: LangyGitHubConnectCardProps) {
  const { connect } = useGitHubConnectPopup();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    setPopupBlocked(false);
    const result = await connect(organizationId);
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
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      maxWidth="420px"
      background="bg.subtle"
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={2}>
          <GitHub size={16} />
          <Text textStyle="sm" fontWeight="640" color="fg">
            {headline}
          </Text>
        </HStack>
        <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
          Langy opens pull requests on the repositories you choose, using
          short-lived tokens.
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
      </VStack>
    </Box>
  );
}
