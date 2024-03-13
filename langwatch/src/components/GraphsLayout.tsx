import { HStack, VStack } from "@chakra-ui/react";
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
            minWidth="150px"
            height="full"
            spacing={0}
          >
            <MenuLink href={`/${project?.slug}`}>Overview</MenuLink>

            <MenuLink href={`/${project?.slug}/analytics/reports`}>
              Reports
            </MenuLink>
          </VStack>
        )}
        {children}
      </HStack>
    </DashboardLayout>
  );
}
