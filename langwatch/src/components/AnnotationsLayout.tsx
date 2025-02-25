import { Avatar, HStack, Separator, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { type PropsWithChildren } from "react";
import { Check, Edit, Inbox, Plus, Users } from "react-feather";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { useDrawer } from "./CurrentDrawer";
import { RandomColorAvatar } from "./RandomColorAvatar";

export default function AnnotationsLayout({
  children,
  isSubscription,
}: PropsWithChildren<{ isSubscription?: boolean }>) {
  const { data: session } = useRequiredSession();
  const user = session?.user;
  const { project } = useOrganizationTeamProject();

  const {
    assignedQueueItemsWithTraces,
    memberAccessibleQueueItemsWithTraces,
    memberAccessibleQueues,
  } = useAnnotationQueues();

  const totalItems =
    (assignedQueueItemsWithTraces?.filter((item) => !item.doneAt).length ?? 0) +
    (memberAccessibleQueueItemsWithTraces?.filter((item) => !item.doneAt)
      .length ?? 0);

  const menuItems = {
    inbox: <Inbox width={20} height={20} />,
    queues: <Users width={20} height={20} />,
    myQueues: (
      <RandomColorAvatar
        size="2xs"
        width={5}
        height={5}
        name={user?.name ?? ""}
      />
    ),
    all: <Edit width={20} height={20} />,
    done: <Check width={20} height={20} />,
  };

  const router = useRouter();
  const { openDrawer } = useDrawer();

  return (
    <DashboardLayout>
      <HStack
        align="start"
        width="full"
        height="full"
        background="gray.100"
        gap={0}
        position="relative"
      >
        <VStack
          align="start"
          background="white"
          paddingY={5}
          borderRightWidth="1px"
          borderColor="gray.300"
          fontSize="14px"
          minWidth="240px"
          height="full"
          gap={1}
          display={isSubscription ? "none" : "flex"}
        >
          <Text fontSize="md" fontWeight="500" paddingX={4} paddingY={2}>
            Annotations
          </Text>

          <MenuLink
            href={`/${project?.slug}/annotations`}
            icon={menuItems.inbox}
            menuEnd={
              <Text fontSize="xs" fontWeight="500">
                {totalItems > 0 ? totalItems : ""}
              </Text>
            }
            isSelectedAnnotation={router.pathname === "/[project]/annotations"}
          >
            Inbox
          </MenuLink>
          <MenuLink
            href={`/${project?.slug}/annotations/me`}
            isSelectedAnnotation={
              router.pathname === "/[project]/annotations/me"
            }
            icon={menuItems.myQueues}
            menuEnd={
              <Text fontSize="xs" fontWeight="500">
                {(() => {
                  const count =
                    assignedQueueItemsWithTraces?.filter((item) => !item.doneAt)
                      .length ?? 0;
                  return count > 0 ? count : "";
                })()}
              </Text>
            }
          >
            {user?.name?.split(" ")[0]} (You)
          </MenuLink>
          <MenuLink
            href={`/${project?.slug}/annotations/all`}
            icon={menuItems.all}
            isSelectedAnnotation={
              router.pathname === "/[project]/annotations/all"
            }
          >
            All
          </MenuLink>
          <Separator />
          <HStack width="full" justify="space-between" paddingRight={3}>
            <Text fontSize="sm" fontWeight="500" paddingX={4} paddingY={2}>
              My Queues
            </Text>
            <Plus
              onClick={() => openDrawer("addAnnotationQueue", undefined)}
              width={18}
              height={18}
              cursor="pointer"
            />
          </HStack>
          {memberAccessibleQueues?.map((queue) => (
            <MenuLink
              key={queue.id}
              href={`/${project?.slug}/annotations/${queue.slug}`}
              isSelectedAnnotation={
                router.pathname ===
                `/${project?.slug}/annotations/${queue.slug}`
              }
              icon={menuItems.queues}
              menuEnd={
                <Text fontSize="xs" fontWeight="500">
                  {(() => {
                    const pendingCount = queue.AnnotationQueueItems.filter(
                      (item) => !item.doneAt
                    ).length;
                    return pendingCount > 0 ? pendingCount : "";
                  })()}
                </Text>
              }
            >
              {queue.name}
            </MenuLink>
          ))}
        </VStack>
        {children}
      </HStack>
    </DashboardLayout>
  );
}
