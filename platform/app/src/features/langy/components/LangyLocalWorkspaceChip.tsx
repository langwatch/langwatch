/**
 * The panel header chip for a shared folder (ADR-129).
 *
 * It is the standing answer to "where is Langy working right now": the folder
 * name while the folder is connected, the machine and the branch behind a
 * hover, and the way to end the share. Nothing renders while no folder is
 * connected, so the header keeps its one line for every other conversation.
 *
 * Disconnecting asks first. It stops whatever is running on the machine, and
 * a header chip is small enough to hit by accident.
 */
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { FolderCode } from "lucide-react";
import { useEffect, useState } from "react";

import { describeError } from "~/features/errors";
import { api } from "~/utils/api";

import { useLangyLocalControlStore } from "../stores/langyLocalControlStore";

export interface LangyLocalWorkspaceChipProps {
  projectId: string;
  conversationId: string;
}

export function LangyLocalWorkspaceChip({
  projectId,
  conversationId,
}: LangyLocalWorkspaceChipProps) {
  const workspaceRevision = useLangyLocalControlStore(
    (s) => s.workspaceRevision,
  );
  const workspace = api.langy.getLocalWorkspace.useQuery(
    { projectId, conversationId },
    { enabled: !!projectId && !!conversationId },
  );
  const refetch = workspace.refetch;
  useEffect(() => {
    if (workspaceRevision === 0) return;
    void refetch();
  }, [workspaceRevision, refetch]);

  const [confirming, setConfirming] = useState(false);
  const folder = workspace.data?.workspace;
  if (!workspace.data?.connected || !folder) return null;

  return (
    <Box position="relative" flexShrink={0}>
      <HStack
        data-testid="langy-workspace-chip"
        gap={1}
        paddingX={1.5}
        paddingY="2px"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="full"
        background="bg.muted"
        maxWidth="180px"
        cursor="default"
        title={workspaceHoverText(folder)}
        onClick={() => setConfirming((open) => !open)}
      >
        <Box color="green.fg" display="flex" flexShrink={0}>
          <FolderCode size={12} />
        </Box>
        <Text textStyle="2xs" color="fg" truncate>
          {folder.name} connected
        </Text>
      </HStack>

      {confirming ? (
        <DisconnectConfirm
          projectId={projectId}
          conversationId={conversationId}
          detail={workspaceHoverText(folder)}
          onDone={() => {
            setConfirming(false);
            void refetch();
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Box>
  );
}

/**
 * Ending the share asks first: it stops whatever is running on the machine,
 * and a header chip is small enough to hit by accident.
 */
function DisconnectConfirm({
  projectId,
  conversationId,
  detail,
  onDone,
  onCancel,
}: {
  projectId: string;
  conversationId: string;
  detail: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const disconnect = api.langy.disconnectLocalWorkspace.useMutation({
    onSuccess: onDone,
    onError: (error) =>
      setFailure(
        describeError({
          error,
          fallbackTitle: "Could not disconnect the folder",
        }),
      ),
  });

  return (
    <Box
      position="absolute"
      top="calc(100% + 4px)"
      right={0}
      zIndex={1}
      minWidth="240px"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      background="bg.panel"
      boxShadow="md"
      padding={2}
    >
      <VStack align="stretch" gap={1.5}>
        <Text textStyle="2xs" color="fg.muted">
          {detail}
        </Text>
        <Text textStyle="2xs" color="fg">
          Disconnect this folder? Langy stops working on your machine.
        </Text>
        <HStack gap={1.5} justifyContent="flex-end">
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Keep it
          </Button>
          <Button
            size="xs"
            colorPalette="red"
            loading={disconnect.isPending}
            onClick={() => disconnect.mutate({ projectId, conversationId })}
          >
            Disconnect
          </Button>
        </HStack>
        {failure ? (
          <Text textStyle="2xs" color="red.fg" role="alert">
            {failure}
          </Text>
        ) : null}
      </VStack>
    </Box>
  );
}

/** The folder, the machine and the branch on one line. */
export function workspaceHoverText(folder: {
  root: string;
  hostname: string;
  gitBranch?: string | null;
}): string {
  const parts = [folder.root, `on ${folder.hostname}`];
  if (folder.gitBranch) parts.push(`branch ${folder.gitBranch}`);
  return parts.join(", ");
}
