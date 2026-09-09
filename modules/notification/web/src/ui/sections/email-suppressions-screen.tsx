/**
 * Who has unsubscribed from a project's notifications. Removing a row RESUMES
 * DELIVERY, so it sits behind `triggers:manage` while the page itself opens on
 * `triggers:view`. The settings frame is applied by whoever serves the address.
 */

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  HStack,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MailX, Trash2 } from "lucide-react";
import { notificationApi } from "../../behavior/notification-api.ts";
import { useNotificationHost } from "../../model/notification-host.ts";
import { readableDate } from "../../model/readable-date.ts";

/** The grant the platform page asked for, unchanged. */
export const EMAIL_SUPPRESSIONS_PAGE_PERMISSION = "triggers:view";

/** The narrower grant the remove button is behind, also unchanged. */
export const EMAIL_SUPPRESSIONS_MANAGE_PERMISSION = "triggers:manage";

export default function EmailSuppressionsScreen() {
  const host = useNotificationHost();
  const project = host.project();
  if (!project) return null;
  return (
    <EmailSuppressionsPage
      projectId={project.id}
      canManage={host.hasPermission(EMAIL_SUPPRESSIONS_MANAGE_PERMISSION)}
    />
  );
}

function EmailSuppressionsPage({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const host = useNotificationHost();
  const utils = notificationApi.useUtils();
  const suppressions = notificationApi.emailSuppression.getAll.useQuery({ projectId });
  const remove = notificationApi.emailSuppression.remove.useMutation({
    onSuccess: async () => {
      await utils.emailSuppression.getAll.invalidate({ projectId });
      host.succeeded({ title: "Suppression removed" });
    },
    onError: (error) => {
      host.failed({ error, fallbackTitle: "Could not remove suppression" });
    },
  });

  /** One region, four outcomes: still loading, failed, empty, or the list. */
  function suppressionsBody() {
    if (suppressions.isLoading) {
      return (
        <HStack justify="center" padding={8}>
          <Spinner />
        </HStack>
      );
    }

    if (suppressions.isError) {
      return (
        <VStack align="center" gap={3} padding={8}>
          <Text color="fg.error">Could not load suppressions. Please try again.</Text>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void suppressions.refetch()}
            loading={suppressions.isRefetching}
          >
            Retry
          </Button>
        </VStack>
      );
    }

    if (!suppressions.data || suppressions.data.length === 0) {
      return (
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Indicator>
              <MailX />
            </EmptyState.Indicator>
            <EmptyState.Title>No suppressions yet</EmptyState.Title>
            <EmptyState.Description>
              When a recipient unsubscribes from a notification, they appear here.
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      );
    }

    return (
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Email</Table.ColumnHeader>
            <Table.ColumnHeader>Scope</Table.ColumnHeader>
            <Table.ColumnHeader>Date</Table.ColumnHeader>
            <Table.ColumnHeader />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {suppressions.data.map((row) => (
            <Table.Row key={row.id}>
              <Table.Cell>{row.email}</Table.Cell>
              <Table.Cell>
                {row.triggerId == null ? (
                  <Badge colorPalette="red">All notifications</Badge>
                ) : (
                  <Badge colorPalette="gray">{row.triggerName ?? "Notification"}</Badge>
                )}
              </Table.Cell>
              <Table.Cell>{readableDate(row.createdAt).toLocaleDateString()}</Table.Cell>
              <Table.Cell textAlign="end">
                {canManage && (
                  <Button
                    size="xs"
                    variant="ghost"
                    loading={remove.isPending && remove.variables?.id === row.id}
                    onClick={() => remove.mutate({ projectId, id: row.id })}
                    aria-label="Remove suppression"
                  >
                    <Trash2 size={14} />
                  </Button>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <VStack gap={6} width="full" align="start" paddingX={6} paddingY={4}>
      <VStack align="start" gap={1} width="full" marginTop={2}>
        <Heading as="h2" fontSize="xl">
          Email Suppressions
        </Heading>
        <Text color="fg.muted">
          Recipients who unsubscribed from this project&apos;s trigger notifications. Removing an
          entry resumes delivery to that address.
        </Text>
      </VStack>

      <Card.Root width="full">
        <Card.Body>{suppressionsBody()}</Card.Body>
      </Card.Root>
    </VStack>
  );
}
