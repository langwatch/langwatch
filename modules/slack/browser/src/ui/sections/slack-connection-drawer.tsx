import { Heading, Skeleton, Text, VStack } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  findSlackConnection,
  type SlackConnection,
  type SlackConnectionList,
  type SlackConnectionSaved,
  slackApi,
} from "@langwatch/slack-browser-kit";

import { useDeleteSlackConnection } from "../../behavior/use-delete-slack-connection.ts";
import { useSaveSlackConnection } from "../../behavior/use-save-slack-connection.ts";
import { SlackConnectionForm } from "../blocks/slack-connection-form.tsx";
import { SlackConnectionReadOnly } from "../blocks/slack-connection-read-only.tsx";
import { DeleteSlackConnectionButton } from "../elements/delete-slack-connection-button.tsx";
import { SlackErrorAlert } from "../elements/slack-error-alert.tsx";

/**
 * `slackConnection`: adds or edits one named Slack connection (ADR-093 §5a). Settings opens
 * it bare; automation's Slack step opens it with `onSuccess` + `onClose` and returns with the
 * new connection selected, the way dataset creation does.
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
  const list = slackApi.slackIntegration.list.useQuery({ projectId }, { enabled: !!projectId });
  const [connection] = findSlackConnection({ connectionId, connections: list.data?.connections });
  const title = connectionId ? (connection?.name ?? "Slack connection") : "Add Slack connection";

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
          <Heading size="md">{title}</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <SlackConnectionDrawerContent
            error={list.error}
            list={list.data}
            projectId={projectId}
            connectionId={connectionId}
            onSaved={(saved) => {
              onSuccess?.(saved);
              close();
            }}
            onDeleted={close}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function SlackConnectionDrawerContent({
  error,
  list,
  ...body
}: {
  error: unknown;
  list: SlackConnectionList | undefined;
  projectId: string;
  connectionId: string | undefined;
  onSaved: (saved: SlackConnectionSaved) => void;
  onDeleted: () => void;
}) {
  if (error) {
    return <SlackErrorAlert error={error} fallbackTitle="Couldn't load Slack connections" />;
  }
  if (!list) {
    return (
      <VStack align="stretch" gap={3}>
        <Skeleton height="32px" />
        <Skeleton height="32px" />
      </VStack>
    );
  }
  return <SlackConnectionDrawerBody list={list} {...body} />;
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
  const [connection] = findSlackConnection({ connectionId, connections: list.connections });

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
    <SlackConnectionEditor
      key={connection?.id ?? "new"}
      projectId={projectId}
      connection={connection}
      list={list}
      onSaved={onSaved}
      onDeleted={onDeleted}
    />
  );
}

function SlackConnectionEditor({
  projectId,
  connection,
  list,
  onSaved,
  onDeleted,
}: {
  projectId: string;
  connection: SlackConnection | undefined;
  list: SlackConnectionList;
  onSaved: (saved: SlackConnectionSaved) => void;
  onDeleted: () => void;
}) {
  const { organization, project } = useOrganizationTeamProject();
  const save = useSaveSlackConnection({ projectId, connection, onSaved });
  return (
    <SlackConnectionForm
      organization={organization}
      project={project}
      connection={connection}
      canManageProject={list.canManageProject}
      canManageOrganization={list.canManageOrganization}
      save={save}
      deleteControl={
        connection ? (
          <SlackConnectionDelete
            projectId={projectId}
            connection={connection}
            onDeleted={onDeleted}
          />
        ) : null
      }
    />
  );
}

function SlackConnectionDelete({
  projectId,
  connection,
  onDeleted,
}: {
  projectId: string;
  connection: SlackConnection;
  onDeleted: () => void;
}) {
  const remove = useDeleteSlackConnection({ projectId, connection, onDeleted });
  return (
    <DeleteSlackConnectionButton
      connection={connection}
      refusals={remove.refusals}
      isPending={remove.isPending}
      onDelete={remove.run}
    />
  );
}
