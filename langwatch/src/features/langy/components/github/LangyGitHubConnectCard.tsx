/**
 * In-chat "Connect GitHub" card. Rendered by LangySidebar when the assistant
 * emits a structured `connect_github` message (or whenever the caller wants to
 * surface the connect affordance proactively, e.g. in onboarding).
 *
 * Clicking the button opens an OAuth popup; on success it resolves with the
 * connected GitHub login and the caller can refetch / replay the user's last
 * prompt so the conversation continues seamlessly.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
 */
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { GitHub } from "react-feather";

import { useGitHubConnectPopup } from "./useGitHubConnectPopup";

export type LangyGitHubConnectCardProps = {
  organizationId: string;
  /** Optional copy override — e.g. include the repo name the user mentioned. */
  headline?: string;
  /** Called after a successful connect with the user's GitHub login. */
  onConnected?: (login: string) => void;
};

export function LangyGitHubConnectCard({
  organizationId,
  headline = "Connect GitHub to open this PR",
  onConnected,
}: LangyGitHubConnectCardProps) {
  const { connect } = useGitHubConnectPopup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    const result = await connect(organizationId);
    setBusy(false);
    if (result.ok) {
      onConnected?.(result.login);
    } else if (result.error !== "Cancelled") {
      setError(result.error);
    }
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
          Langy opens PRs authored by your GitHub user, using short-lived
          tokens.
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
          Connect GitHub
        </Button>
        {error ? (
          <Text textStyle="xs" color="red.fg">
            {error}
          </Text>
        ) : null}
      </VStack>
    </Box>
  );
}
