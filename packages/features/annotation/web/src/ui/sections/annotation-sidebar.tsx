/**
 * The annotations sidebar: the three standing lists, then a queue per entry the
 * reviewer is a member of, each with the work still waiting on it.
 *
 * A FAMILY-LOCAL COPY of `platform/app/src/components/AnnotationsLayout`. The
 * platform component stays where it is, because the annotation queue walker
 * (`/annotations/my-queue`) still renders it and that key did not move — it
 * mounts four thousand lines of `features/traces-v2`' conversation view, which
 * belongs to the traces family. The two die together when it does.
 *
 * WHAT THE COPY DROPPED, and it is the same drop every moved family takes:
 * `DashboardLayout`. Chrome belongs to the route tree, and these pages are
 * children of a layout route the composing application still serves; the
 * platform layout's job here was the annotations sub-sidebar, and that is what
 * travelled.
 *
 * ALSO DROPPED: the Langy context targets on the sidebar entries.
 * `@langwatch/langy-web` is ungoverned and `apps/ui` may not import it, which is
 * the same loss the me, automations, agents and datasets families recorded.
 *
 * THE ACTIVE ENTRY IS NOT READ FROM THE ADDRESS. The platform layout compared
 * `usePathname()` to a built href, which is why it needed the concrete path
 * rather than the route pattern. The screen was told which view it is, so the
 * sidebar is told too, and the queue entry compares slugs rather than paths.
 */

import { Box, Button, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Inbox, MoreVertical, Pencil, Plus, SquarePen, Users } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { useState } from "react";
import type { AnnotationQueueBadge } from "../../behavior/annotation-api";
import type { AnnotationView } from "../../model/annotation-view";
import { ReviewerAvatar } from "../elements/reviewer-avatar";
import { SidebarMenuLink } from "../elements/sidebar-menu-link";

/** A badge shows a number or nothing; zero is not news. */
function PendingCount({ count }: { count: number | undefined }) {
  return (
    <Text fontSize="10.5px" fontWeight="500">
      {count && count > 0 ? count : ""}
    </Text>
  );
}

/**
 * One queue in the sidebar list. The queue's own actions live here rather than
 * on the page it opens, so they are reachable from wherever the reviewer is.
 * The trigger takes the trailing slot the pending count sits in, and only on
 * hover, so a resting sidebar still reads as counts.
 */
function QueueSidebarEntry({
  queue,
  href,
  isSelected,
  icon,
  canEdit,
  onEdit,
}: {
  queue: AnnotationQueueBadge;
  href: string;
  isSelected: boolean;
  icon: ReactNode;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Box width="full" borderRadius="lg" position="relative" className="group">
      <SidebarMenuLink
        href={href}
        isSelected={isSelected}
        icon={icon}
        menuEnd={
          <Text
            fontSize="10.5px"
            fontWeight="500"
            opacity={canEdit && menuOpen ? 0 : 1}
            _groupHover={canEdit ? { opacity: 0 } : void 0}
          >
            {queue.pendingCount > 0 ? queue.pendingCount : ""}
          </Text>
        }
      >
        {queue.name}
      </SidebarMenuLink>
      {canEdit && (
        // Beside the link rather than inside it: a button nested in an anchor
        // is invalid, and a click on it would also follow the link.
        <Box
          position="absolute"
          right={1}
          top="50%"
          transform="translateY(-50%)"
          opacity={menuOpen ? 1 : 0}
          _groupHover={{ opacity: 1 }}
          _focusWithin={{ opacity: 1 }}
        >
          <Menu.Root open={menuOpen} onOpenChange={({ open }) => setMenuOpen(open)}>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Actions for queue ${queue.name}`}
                minWidth={0}
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
        </Box>
      )}
    </Box>
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
  queues: readonly AnnotationQueueBadge[];
  /** Which queue the `queue` view is on, from the route parameter. */
  activeQueueSlug: string | undefined;
  /** A lite member reads queues and does not define them. */
  canManageQueues: boolean;
  onCreateQueue: () => void;
  onEditQueue: (queueId: string) => void;
}>) {
  return (
    <HStack align="start" width="full" height="full" gap={0} position="relative">
      <VStack
        align="start"
        paddingY={4}
        borderRightWidth="1px"
        borderColor="border.emphasized"
        fontSize="12.5px"
        minWidth="218px"
        height="full"
        gap={0.5}
      >
        <Text fontSize="14px" fontWeight="semibold" paddingX={3} paddingY={1.5}>
          Annotations
        </Text>
        <VStack paddingX={2} gap={0.5} width="full">
          <SidebarMenuLink
            href={`/${projectSlug}/annotations`}
            icon={<Inbox width={15} height={15} />}
            menuEnd={<PendingCount count={pendingCount} />}
            isSelected={view === "inbox"}
          >
            Inbox
          </SidebarMenuLink>
          <SidebarMenuLink
            href={`/${projectSlug}/annotations/me`}
            isSelected={view === "mine"}
            icon={
              <ReviewerAvatar
                size="2xs"
                width={5}
                height={5}
                name={reviewerName ?? ""}
                image={reviewerImage}
              />
            }
            menuEnd={<PendingCount count={assignedCount} />}
          >
            {reviewerName?.split(" ")[0]} (You)
          </SidebarMenuLink>
          <SidebarMenuLink
            href={`/${projectSlug}/annotations/all`}
            icon={<SquarePen width={15} height={15} />}
            isSelected={view === "all"}
          >
            All
          </SidebarMenuLink>
          <Separator />
          <HStack width="full" justify="space-between" paddingRight={2} paddingTop={1.5}>
            <Text
              fontSize="10px"
              fontWeight="semibold"
              textTransform="uppercase"
              letterSpacing="0.025em"
              color="fg.muted"
              paddingX={2.5}
              paddingY={0.5}
            >
              My Queues
            </Text>
            {canManageQueues && (
              <Button
                size="xs"
                variant="ghost"
                minWidth={0}
                paddingX={1}
                aria-label="Create annotation queue"
                onClick={onCreateQueue}
              >
                <Plus width={14} height={14} />
              </Button>
            )}
          </HStack>
          {queues.map((queue) => (
            <QueueSidebarEntry
              key={queue.id}
              queue={queue}
              href={`/${projectSlug}/annotations/${queue.slug}`}
              isSelected={view === "queue" && activeQueueSlug === queue.slug}
              icon={<Users width={15} height={15} />}
              canEdit={canManageQueues}
              onEdit={() => onEditQueue(queue.id)}
            />
          ))}
        </VStack>
      </VStack>
      {children}
    </HStack>
  );
}
