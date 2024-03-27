import { HStack, Text, VStack } from "@chakra-ui/react";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export default function GraphsLayout({ children }: PropsWithChildren) {
  const { project } = useOrganizationTeamProject();

  return (
    <DashboardLayout>
      <HStack align="start" width="full" height="full">
        {process.env.NEXT_PUBLIC_REPORTS && (
          <VStack
            align="start"
            background="white"
            paddingY={4}
            borderRightWidth="1px"
            borderColor="gray.300"
            fontSize="14px"
            minWidth="180px"
            height="full"
            spacing={1}
          >
            <MenuLink href={`/${project?.slug}`}>Overview</MenuLink>
            <VStack align="start" width="full" spacing={0}>
              <Text fontWeight={"bold"} paddingX={4} paddingY={2}>
                Engagement
              </Text>
              <MenuLink href={`/${project?.slug}/analytics/users`} paddingX={6}>
                Users
              </MenuLink>
              <MenuLink
                href={`/${project?.slug}/analytics/topics`}
                paddingX={6}
              >
                Topics
              </MenuLink>
            </VStack>
            <VStack align="start" width="full" spacing={0}>
              <Text fontWeight={"bold"} paddingX={4} paddingY={2}>
                Observabilty
              </Text>
              <MenuLink
                href={`/${project?.slug}/analytics/evaluations`}
                paddingX={6}
              >
                Evaluations
              </MenuLink>
              <MenuLink
                href={`/${project?.slug}/analytics/metrics`}
                paddingX={6}
              >
                Metrics
              </MenuLink>
            </VStack>
            <VStack align="start" width="full" spacing={0}>
              <Text fontWeight={"bold"} paddingX={4} paddingY={2}>
                Custom
              </Text>
              <MenuLink
                href={`/${project?.slug}/analytics/reports`}
                paddingX={6}
              >
                Reports
              </MenuLink>
            </VStack>
          </VStack>
        )}
        {children}
      </HStack>
    </DashboardLayout>
  );
}
