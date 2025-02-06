import { Badge, Divider, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { Mail, Users } from "react-feather";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";

export default function AnnotationsLayout({
  children,
  isSubscription,
}: PropsWithChildren<{ isSubscription?: boolean }>) {
  const { project } = useOrganizationTeamProject();
  const { data: session } = useRequiredSession();

  const user = session?.user;

  console.log("user", user);

  const queues = api.annotation.getQueues.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project,
    }
  );
  console.log(queues.data);

  const userQueues = queues.data?.filter((queue) =>
    queue.members.some((member) => member.userId === user?.id)
  );

  console.log("userQueues", userQueues);
  return (
    <DashboardLayout>
      <HStack align="start" width="full" height="full">
        <VStack
          align="start"
          background="white"
          paddingY={4}
          borderRightWidth="1px"
          borderColor="gray.300"
          fontSize="14px"
          minWidth="200px"
          height="full"
          spacing={0}
          display={isSubscription ? "none" : "flex"}
        >
          <Text fontSize="md" fontWeight="500" paddingX={4} paddingY={2}>
            Annotations
          </Text>
          <MenuLink
            href="/settings"
            icon={Mail}
            menuEnd={<Badge colorScheme="orange">10</Badge>}
          >
            Inbox
          </MenuLink>
          <Divider />
          <Text fontSize="sm" fontWeight="500" paddingX={4} paddingY={2}>
            My Queues
          </Text>
          {userQueues?.map((queue) => (
            <MenuLink
              key={queue.id}
              href={`/settings/queues/${queue.id}`}
              icon={Users}
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
