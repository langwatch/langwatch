import { Box, Button, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import { MoreVertical, Pencil } from "lucide-react";
import { type PropsWithChildren, useState } from "react";
import { Check, Edit, Inbox, Plus, Users } from "react-feather";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { annotationContextChip } from "~/features/langy/logic/langyContextChips";
import { useDrawer } from "~/hooks/useDrawer";
import { useLiteMemberGuard } from "~/hooks/useLiteMemberGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { usePathname } from "~/utils/compat/next-navigation";
import { RandomColorAvatar } from "./RandomColorAvatar";
import { Menu } from "./ui/menu";

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
}: {
  queue: { id: string; name: string; pendingCount: number };
  href: string;
  isSelected: boolean;
  icon: React.ReactNode;
  canEdit: boolean;
}) {
  const { openDrawer } = useDrawer();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    // A Box, not the MenuLink itself: MenuLink takes a fixed prop set and would
    // drop the Langy target's className / handlers on the floor. The Box is
    // width-full and carries the link's own radius, so the outline lands
    // exactly on the row.
    <Box width="full" borderRadius="lg" position="relative" className="group">
      <MenuLink
        href={href}
        isSelectedAnnotation={isSelected}
        icon={icon}
        menuEnd={
          <Text
            fontSize="xs"
            fontWeight="500"
            opacity={canEdit && menuOpen ? 0 : 1}
            _groupHover={canEdit ? { opacity: 0 } : undefined}
          >
            {queue.pendingCount > 0 ? queue.pendingCount : ""}
          </Text>
        }
      >
        {queue.name}
      </MenuLink>
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
              <Menu.Item
                value="edit"
                onClick={() => openDrawer("addAnnotationQueue", { queueId: queue.id })}
              >
                <Pencil size={14} /> Edit queue
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        </Box>
      )}
    </Box>
  );
}

export default function AnnotationsLayout({
  children,
  isSubscription,
}: PropsWithChildren<{ isSubscription?: boolean }>) {
  const { data: session } = useRequiredSession();
  const user = session?.user;
  const { project } = useOrganizationTeamProject();
  const { isLiteMember } = useLiteMemberGuard();

  // Use optimized count endpoints instead of fetching full data
  const pendingItemsCount = api.annotation.getPendingItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const assignedItemsCount = api.annotation.getAssignedItemsCount.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const queueItemsCounts = api.annotation.getQueueItemsCounts.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const menuItems = {
    inbox: <Inbox width={20} height={20} />,
    queues: <Users width={20} height={20} />,
    myQueues: (
      <RandomColorAvatar size="2xs" width={5} height={5} name={user?.name ?? ""} />
    ),
    all: <Edit width={20} height={20} />,
    done: <Check width={20} height={20} />,
  };

  // The concrete path the browser is on. `router.pathname` is a route PATTERN
  // ("/[project]/annotations/[slug]"), so comparing it to a built href never
  // matches and no entry ever reads as the current one.
  const pathname = usePathname();
  const { openDrawer } = useDrawer();

  return (
    <DashboardLayout>
      <HStack align="start" width="full" height="full" gap={0} position="relative">
        <VStack
          align="start"
          paddingY={5}
          borderRightWidth="1px"
          borderColor="border.emphasized"
          fontSize="14px"
          minWidth="240px"
          height="full"
          gap={1}
          display={isSubscription ? "none" : "flex"}
        >
          <Text fontSize="md" fontWeight="500" paddingX={4} paddingY={2}>
            Annotations
          </Text>
          <VStack px={2} w="full">
            <MenuLink
              href={`/${project?.slug}/annotations`}
              icon={menuItems.inbox}
              menuEnd={
                <Text fontSize="xs" fontWeight="500">
                  {pendingItemsCount.data && pendingItemsCount.data > 0
                    ? pendingItemsCount.data
                    : ""}
                </Text>
              }
              isSelectedAnnotation={pathname === `/${project?.slug}/annotations`}
            >
              Inbox
            </MenuLink>
            <MenuLink
              href={`/${project?.slug}/annotations/me`}
              isSelectedAnnotation={pathname === `/${project?.slug}/annotations/me`}
              icon={menuItems.myQueues}
              menuEnd={
                <Text fontSize="xs" fontWeight="500">
                  {assignedItemsCount.data && assignedItemsCount.data > 0
                    ? assignedItemsCount.data
                    : ""}
                </Text>
              }
            >
              {user?.name?.split(" ")[0]} (You)
            </MenuLink>
            <MenuLink
              href={`/${project?.slug}/annotations/all`}
              icon={menuItems.all}
              isSelectedAnnotation={pathname === `/${project?.slug}/annotations/all`}
            >
              All
            </MenuLink>
            <Separator />
            <HStack width="full" justify="space-between" paddingRight={3}>
              <Text fontSize="sm" fontWeight="500" paddingX={4} paddingY={2}>
                My Queues
              </Text>
              {!isLiteMember && (
                <Plus
                  onClick={() => openDrawer("addAnnotationQueue", undefined)}
                  width={18}
                  height={18}
                  cursor="pointer"
                />
              )}
            </HStack>
            {queueItemsCounts.data?.map((queue) => (
              // Armed, the queue can be handed to Langy. Keyed on the SLUG,
              // because that is what `/annotations/<slug>` puts in the URL and
              // therefore what the route-derived chip uses.
              <LangyContextTarget
                key={queue.id}
                target={annotationContextChip({
                  annotationId: queue.slug,
                  name: queue.name,
                  noun: "annotation queue",
                })}
              >
                <QueueSidebarEntry
                  queue={queue}
                  href={`/${project?.slug}/annotations/${queue.slug}`}
                  isSelected={pathname === `/${project?.slug}/annotations/${queue.slug}`}
                  icon={menuItems.queues}
                  canEdit={!isLiteMember}
                />
              </LangyContextTarget>
            ))}
          </VStack>
        </VStack>
        {children}
      </HStack>
    </DashboardLayout>
  );
}
