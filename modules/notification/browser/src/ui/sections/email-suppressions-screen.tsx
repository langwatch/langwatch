/**
 * Who has unsubscribed from a project's notifications. Removing a row RESUMES
 * DELIVERY, so it sits behind `triggers:manage` while the page itself opens on
 * `triggers:view`. The settings frame is applied by whoever serves the address.
 */

import { Card } from "@langwatch/design-system/card";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { LoadMore } from "@langwatch/design-system/load-more";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Badge, Button, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import { readableDate } from "@langwatch/time";
import { Mail, MailX, Trash2 } from "lucide-react";

import { notificationApi } from "../../behavior/notification-api.ts";
import {
  EMAIL_SUPPRESSIONS_MANAGE_PERMISSION,
  useNotificationHost,
} from "../../model/notification-host.ts";

const PAGE_SIZE = 50;

const AUTOMATIONS_DOCS = {
  kind: "docs",
  label: "How notifications are set up",
  href: "https://docs.langwatch.ai/features/automations",
} as const;

export default function EmailSuppressionsScreen() {
  const host = useNotificationHost();
  const project = host.project();
  if (!project) return null;
  return (
    <EmailSuppressionsPage
      projectId={project.id}
      projectSlug={project.slug}
      canManage={host.hasPermission(EMAIL_SUPPRESSIONS_MANAGE_PERMISSION)}
    />
  );
}

function EmailSuppressionsPage({
  projectId,
  projectSlug,
  canManage,
}: {
  projectId: string;
  projectSlug?: string;
  canManage: boolean;
}) {
  const host = useNotificationHost();
  const utils = notificationApi.useUtils();
  const suppressions = notificationApi.emailSuppression.getPage.useInfiniteQuery(
    { projectId, limit: PAGE_SIZE },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? void 0 },
  );
  const rows = suppressions.data?.pages.flatMap((page) => page.suppressions) ?? [];
  const remove = notificationApi.emailSuppression.remove.useMutation({
    onSuccess: async () => {
      await utils.emailSuppression.getPage.invalidate({ projectId });
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
        <Card padding="none">
          <VStack gap={4} align="stretch" padding={4} aria-busy="true">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} height="5" />
            ))}
          </VStack>
        </Card>
      );
    }

    if (suppressions.isError && rows.length === 0) {
      return (
        <Card padding="none">
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
        </Card>
      );
    }

    if (rows.length === 0) {
      return (
        <NoDataInfoBlock
          title="No suppressions yet"
          description="When a recipient unsubscribes from a notification, they appear here."
          icon={<MailX />}
          next={
            projectSlug
              ? [
                  {
                    kind: "setting",
                    label: "Open automations",
                    href: `/${projectSlug}/automations`,
                  },
                  AUTOMATIONS_DOCS,
                ]
              : [AUTOMATIONS_DOCS]
          }
        />
      );
    }

    return (
      <Card padding="none">
        <ListTable variant="embedded" scroll="x" scrollLabel="Email suppressions table">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Recipient</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Scope</ListTable.ColumnHeader>
              <ListTable.ActionHeader />
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {rows.map((row) => (
              <ListTable.Row key={row.id}>
                <ListTable.Cell>
                  <HStack gap={3}>
                    <Mail size={16} />
                    <VStack align="start" gap={0}>
                      <Text fontWeight="medium">{row.email}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        Unsubscribed {readableDate(row.createdAt).toLocaleDateString()}
                      </Text>
                    </VStack>
                  </HStack>
                </ListTable.Cell>
                <ListTable.Cell>
                  {row.triggerId == null ? (
                    <Badge colorPalette="red">All notifications</Badge>
                  ) : (
                    <Badge colorPalette="gray">{row.triggerName ?? "Notification"}</Badge>
                  )}
                </ListTable.Cell>
                <ListTable.ActionCell>
                  {canManage && (
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Actions for ${row.email}`}
                          loading={remove.isPending && remove.variables?.id === row.id}
                        >
                          <MoreVerticalIcon size={14} />
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
                </ListTable.ActionCell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
        {suppressions.isError && (
          <HStack justify="center" gap={2} paddingY={3}>
            <Text as="output" textStyle="xs" color="fg.error">
              Could not load more suppressions.
            </Text>
            <Button size="xs" variant="outline" onClick={() => void suppressions.fetchNextPage()}>
              Retry
            </Button>
          </HStack>
        )}
        <LoadMore
          hasMore={!suppressions.isError && (suppressions.hasNextPage ?? false)}
          loading={suppressions.isFetchingNextPage}
          onLoadMore={() => void suppressions.fetchNextPage()}
          shown={rows.length}
          unitLabel="suppressions"
        />
      </Card>
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
