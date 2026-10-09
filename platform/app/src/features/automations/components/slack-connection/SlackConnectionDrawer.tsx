import { Heading, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "~/components/ui/drawer";
import { HandledErrorAlert } from "~/features/errors";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { SlackConnectionForm } from "./SlackConnectionForm";
import { SlackConnectionReadOnly } from "./SlackConnectionReadOnly";
import type {
  SlackConnectionList,
  SlackConnectionSaved,
} from "./slackConnectionTypes";

/**
 * Adds or edits one named Slack connection (ADR-093 §5a). Settings opens it
 * bare; the automation's Slack step opens it with `onSuccess` + `onClose` and
 * returns with the new connection selected, the way dataset creation does.
 */
export function SlackConnectionDrawer({
  connectionId,
  onSuccess,
  onClose,
}: {
  connectionId?: string;
  onSuccess?: (saved: SlackConnectionSaved) => void;
  onClose?: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const close = onClose ?? closeDrawer;
  const projectId = project?.id ?? "";
  const list = api.slackIntegration.list.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const connection = connectionId
    ? list.data?.connections.find((candidate) => candidate.id === connectionId)
    : undefined;

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="md"
      onOpenChange={({ open }) => {
        if (!open) close();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">
            {connectionId
              ? (connection?.name ?? "Slack connection")
              : "Add Slack connection"}
          </Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {list.error ? (
            <HandledErrorAlert
              error={list.error}
              fallbackTitle="Couldn't load Slack connections"
            />
          ) : !list.data ? (
            <VStack align="stretch" gap={3}>
              <Skeleton height="32px" />
              <Skeleton height="32px" />
            </VStack>
          ) : (
            <SlackConnectionDrawerBody
              projectId={projectId}
              connectionId={connectionId}
              list={list.data}
              onSaved={(saved) => {
                onSuccess?.(saved);
                close();
              }}
              onDeleted={close}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SlackConnectionDrawerBody({
  projectId,
  connectionId,
  list,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  connectionId: string | undefined;
  list: SlackConnectionList;
  onSaved: (saved: SlackConnectionSaved) => void;
  onDeleted: () => void;
}) {
  const connection = connectionId
    ? list.connections.find((candidate) => candidate.id === connectionId)
    : undefined;

  if (connectionId && !connection) {
    return (
      <Text fontSize="sm" color="fg.muted">
        This Slack connection no longer exists.
      </Text>
    );
  }
  if (connection && !connection.canManage) {
    return <SlackConnectionReadOnly connection={connection} />;
  }
  if (!connection && !list.canManageProject && !list.canManageOrganization) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Ask a project or organization admin to add a Slack connection.
      </Text>
    );
  }
  return (
    <SlackConnectionForm
      key={connection?.id ?? "new"}
      projectId={projectId}
      connection={connection}
      canManageProject={list.canManageProject}
      canManageOrganization={list.canManageOrganization}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
}
