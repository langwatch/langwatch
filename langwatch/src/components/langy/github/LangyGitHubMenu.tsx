/**
 * GitHub connection control for the Langy panel header.
 *
 * Replaces the footer "Acting as @login" chip, which had two problems: it ate
 * a permanent row under the composer, and it rendered nothing when NOT
 * connected — leaving no discoverable way to connect GitHub from Langy at
 * all (you had to know about Settings → Integrations or stumble into the
 * in-chat connect card).
 *
 * One icon-button, two states:
 *   - not connected → tooltip "Connect GitHub", click opens the OAuth popup
 *     right here (same popup the in-chat card uses) and the conversation
 *     never leaves the screen.
 *   - connected → green status dot on the icon; click opens a menu showing
 *     the acting identity with a Disconnect action.
 *
 * Hidden entirely while the connection state is still loading or when the
 * instance has the GitHub feature off (query errors / returns nothing and
 * connect would 503 — the header shouldn't advertise a dead button).
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */
import { Box, IconButton } from "@chakra-ui/react";
import { useState } from "react";
import { GitHub } from "react-feather";

import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { api } from "~/utils/api";
import { useGitHubConnectPopup } from "./useGitHubConnectPopup";

export function LangyGitHubMenu({
  organizationId,
}: {
  organizationId: string;
}) {
  const utils = api.useUtils();
  const connection = api.langyGithub.getConnection.useQuery({ organizationId });
  const disconnect = api.langyGithub.disconnect.useMutation({
    onSuccess: () => {
      void utils.langyGithub.getConnection.invalidate({ organizationId });
    },
  });
  const { connect } = useGitHubConnectPopup();
  const [connecting, setConnecting] = useState(false);

  if (connection.isLoading || connection.isError) return null;

  if (!connection.data) {
    const onConnect = async () => {
      setConnecting(true);
      const result = await connect(organizationId);
      setConnecting(false);
      if (result.ok) {
        void utils.langyGithub.getConnection.invalidate({ organizationId });
        toaster.create({
          title: `Connected as @${result.login}`,
          type: "success",
        });
      } else if (result.error !== "Cancelled") {
        toaster.create({ title: result.error, type: "error" });
      }
    };
    return (
      <Tooltip content="Connect GitHub — let Langy open PRs as you" showArrow>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Connect GitHub"
          color="fg.muted"
          loading={connecting}
          onClick={() => void onConnect()}
        >
          <GitHub size={14} />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Tooltip
        content={`GitHub connected — acting as @${connection.data.githubLogin}`}
        showArrow
      >
        <Menu.Trigger asChild>
          <IconButton
            size="xs"
            variant="ghost"
            aria-label={`GitHub: acting as @${connection.data.githubLogin}`}
            color="fg.muted"
            position="relative"
          >
            <GitHub size={14} />
            <Box
              position="absolute"
              top="4px"
              right="4px"
              width="6px"
              height="6px"
              borderRadius="full"
              background="green.solid"
            />
          </IconButton>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content minWidth="220px">
        <Menu.ItemGroup>
          <Box paddingX={2} paddingY={1} fontSize="xs" color="fg.muted">
            Acting as <strong>@{connection.data.githubLogin}</strong>
          </Box>
        </Menu.ItemGroup>
        <Menu.Separator />
        <Menu.Item
          value="disconnect"
          color="red.fg"
          disabled={disconnect.isPending}
          onClick={() => disconnect.mutate({ organizationId })}
        >
          {disconnect.isPending ? "Disconnecting…" : "Disconnect GitHub"}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
