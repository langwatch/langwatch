/**
 * Annotations sidebar: three standing lists and per-entry queues, on the shared section rail.
 * Local copy (see platform/app/src/components/AnnotationsLayout).
 */

import type { AnnotationQueuePendingCount } from "@langwatch/annotation-contract";
import { Menu } from "@langwatch/design-system/menu";
import { Button, Stack } from "@langwatch/design-system/primitives";
import {
  SectionNavigationRail,
  type SectionNavigationLink,
} from "@langwatch/design-system/section-navigation-frame";
import { Inbox, MoreVertical, Pencil, SquarePen, Users } from "lucide-react";
import type { PropsWithChildren } from "react";

import { useAnnotationHost } from "../../model/annotation-host.ts";
import type { AnnotationView } from "../../model/annotation-view.ts";
import { ReviewerAvatar } from "../elements/reviewer-avatar.tsx";

/** A count shows a number or nothing; zero is not news. */
const countOf = (count: number | undefined) => (count && count > 0 ? count : void 0);

/** A queue's own actions; they live on the entry, reachable from wherever the reviewer is. */
function QueueMenu({ name, onEdit }: { name: string; onEdit: () => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for queue ${name}`}
          minWidth={0}
          height="20px"
          paddingX={1}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="edit" onClick={onEdit}>
          <Pencil size={14} /> Edit queue
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export function AnnotationSidebar({
  view,
  projectSlug,
  reviewerName,
  reviewerImage,
  pendingCount,
  assignedCount,
  queues,
  activeQueueSlug,
  canManageQueues,
  onCreateQueue,
  onEditQueue,
  children,
}: PropsWithChildren<{
  view: AnnotationView;
  projectSlug: string | undefined;
  reviewerName: string | null;
  reviewerImage: string | null;
  /** Work waiting for the reviewer across every queue they are on. */
  pendingCount: number | undefined;
  /** Items queued directly for the reviewer. */
  assignedCount: number | undefined;
  queues: readonly AnnotationQueuePendingCount[];
  /** Which queue the `queue` view is on, from the route parameter. */
  activeQueueSlug: string | undefined;
  /** A lite member reads queues and does not define them. */
  canManageQueues: boolean;
  onCreateQueue: () => void;
  onEditQueue: (queueId: string) => void;
}>) {
  const host = useAnnotationHost();
  const base = `/${projectSlug}/annotations`;
  const standing: SectionNavigationLink[] = [
    { label: "Inbox", href: base, icon: <Inbox size={14} />, badge: countOf(pendingCount) },
    {
      label: `${reviewerName?.split(" ")[0] ?? ""} (You)`,
      href: `${base}/me`,
      icon: (
        <ReviewerAvatar
          size="2xs"
          width={5}
          height={5}
          name={reviewerName ?? ""}
          image={reviewerImage}
        />
      ),
      badge: countOf(assignedCount),
    },
    { label: "All", href: `${base}/all`, icon: <SquarePen size={14} /> },
  ];
  const queueLinks: SectionNavigationLink[] = queues.map((queue) => ({
    label: queue.name,
    href: `${base}/${queue.slug}`,
    icon: <Users size={14} />,
    badge: countOf(queue.pendingCount),
    actions: canManageQueues ? (
      <QueueMenu name={queue.name} onEdit={() => onEditQueue(queue.id)} />
    ) : (
      void 0
    ),
  }));
  const activeByView: Record<AnnotationView, string> = {
    inbox: base,
    mine: `${base}/me`,
    all: `${base}/all`,
    queue: activeQueueSlug ? `${base}/${activeQueueSlug}` : "",
  };

  return (
    <Stack
      direction={{ base: "column", md: "row" }}
      align="stretch"
      width="full"
      height="full"
      gap={0}
      position="relative"
    >
      <SectionNavigationRail
        label="Annotations"
        links={standing}
        groups={[
          {
            label: "My Queues",
            links: queueLinks,
            add: canManageQueues
              ? { label: "New Queue", onClick: onCreateQueue, testId: "annotation-queue-create" }
              : void 0,
          },
        ]}
        activeHref={activeByView[view]}
        onNavigate={(href) => host.navigate(href)}
      />
      {children}
    </Stack>
  );
}
