/**
 * "Acting as @login" chip for the Langy sidebar footer. Resolves the
 * connection via tRPC; renders nothing when not connected (callers can show
 * a connect affordance instead). Hovering exposes a Disconnect action.
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */
import { Button, HStack, Text } from "@chakra-ui/react";
import { Github } from "react-feather";

import { api } from "~/utils/api";

export type LangyGitHubChipProps = {
  organizationId: string;
};

export function LangyGitHubChip({ organizationId }: LangyGitHubChipProps) {
  const utils = api.useUtils();
  const connection = api.langyGithub.getConnection.useQuery({ organizationId });
  const disconnect = api.langyGithub.disconnect.useMutation({
    onSuccess: () => {
      void utils.langyGithub.getConnection.invalidate({ organizationId });
    },
  });

  if (!connection.data) return null;

  return (
    <HStack gap={2} fontSize="xs" color="gray.600">
      <Github size={12} />
      <Text>Acting as @{connection.data.githubLogin}</Text>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => disconnect.mutate({ organizationId })}
        loading={disconnect.isPending}
      >
        Disconnect
      </Button>
    </HStack>
  );
}
