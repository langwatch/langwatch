/**
 * Who has unsubscribed from a project's notifications. Removing a row RESUMES
 * DELIVERY, so it sits behind `triggers:manage` while the page itself opens on
 * `triggers:view`. The settings frame is applied by whoever serves the address.
 */

import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Button,
  Card,
  HStack,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Mail, MailX, MoreVertical, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { notificationApi } from "../../behavior/notification-api.ts";
import {
  EMAIL_SUPPRESSIONS_MANAGE_PERMISSION,
  useNotificationHost,
} from "../../model/notification-host.ts";
import { readableDate } from "../../model/readable-date.ts";

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
        <SuppressionsCard>
          <VStack gap={4} align="stretch" padding={4} aria-busy="true">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height="5" />
            ))}
          </VStack>
        </SuppressionsCard>
      );
    }

    if (suppressions.isError) {
      return (
        <SuppressionsCard>
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
        </SuppressionsCard>
      );
    }

    if (!suppressions.data || suppressions.data.length === 0) {
      return (
        <NoDataInfoBlock
          title="No suppressions yet"
          description="When a recipient unsubscribes from a notification, they appear here."
          icon={<MailX />}
        />
      );
    }

    return (
      <SuppressionsCard>
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Recipient</Table.ColumnHeader>
              <Table.ColumnHeader>Scope</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {suppressions.data.map((row) => (
              <Table.Row key={row.id}>
                <Table.Cell>
                  <HStack gap={3}>
                    <Mail size={16} />
                    <VStack align="start" gap={0}>
                      <Text fontWeight="medium">{row.email}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        Unsubscribed {readableDate(row.createdAt).toLocaleDateString()}
                      </Text>
                    </VStack>
                  </HStack>
                </Table.Cell>
                <Table.Cell>
                  {row.triggerId == null ? (
                    <Badge colorPalette="red">All notifications</Badge>
                  ) : (
                    <Badge colorPalette="gray">{row.triggerName ?? "Notification"}</Badge>
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end">
                  {canManage && (
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Actions for ${row.email}`}
                          loading={remove.isPending && remove.variables?.id === row.id}
                        >
                          <MoreVertical size={14} />
                        </Button>
                      </Menu.Trigger>
                      <Menu.Content>
                        <Menu.Item
                          value="remove"
                          color="fg.error"
                          onClick={() => remove.mutate({ projectId, id: row.id })}
                        >
                          <Trash2 size={14} /> Remove suppression
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Root>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </SuppressionsCard>
    );
  }

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Email Suppressions</PageLayout.Heading>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">
          Recipients who unsubscribed from this project&apos;s trigger notifications. Removing an
          entry resumes delivery to that address.
        </Text>

        {suppressionsBody()}
      </VStack>
    </>
  );
}

/** The one bordered card the list, its loading rows and its failure sit in. */
function SuppressionsCard({ children }: { children: ReactNode }) {
  return (
    <Card.Root width="full" overflow="hidden">
      <Card.Body paddingX={0} paddingY={0} overflowX="auto">
        {children}
      </Card.Body>
    </Card.Root>
  );
}
