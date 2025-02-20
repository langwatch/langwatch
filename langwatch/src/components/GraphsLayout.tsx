import { Container, HStack, Text, VStack } from "@chakra-ui/react";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useFilterToggle } from "./filters/FilterToggle";
import { SmallLabel } from "./SmallLabel";

export default function GraphsLayout({ children }: PropsWithChildren) {
  const { project } = useOrganizationTeamProject();
  const { showFilters } = useFilterToggle();

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
          minWidth="180px"
          height="full"
          spacing={1}
        >
          <MenuLink href={`/${project?.slug}`}>Overview</MenuLink>
          <VStack align="start" width="full" spacing={0}>
            {/* TODO: reduce font size to 11 once the rest of the page also have a smaller fit */}
            <SmallLabel
              paddingX={4}
              paddingTop={4}
              paddingBottom={2}
              color="gray.700"
              fontSize="12px"
            >
              Engagement
            </SmallLabel>
            <MenuLink href={`/${project?.slug}/analytics/users`} paddingX={6}>
              Users
            </MenuLink>
            <MenuLink href={`/${project?.slug}/analytics/topics`} paddingX={6}>
              Topics
            </MenuLink>
          </VStack>
          <VStack align="start" width="full" spacing={0}>
            <SmallLabel
              paddingX={4}
              paddingTop={4}
              paddingBottom={2}
              color="gray.700"
              fontSize="12px"
            >
              Observability
            </SmallLabel>
            <MenuLink href={`/${project?.slug}/analytics/metrics`} paddingX={6}>
              LLM Metrics
            </MenuLink>
            <MenuLink
              href={`/${project?.slug}/analytics/evaluations`}
              paddingX={6}
            >
              Evaluations
            </MenuLink>
          </VStack>
          <VStack align="start" width="full" spacing={0}>
            <SmallLabel
              paddingX={4}
              paddingTop={4}
              paddingBottom={2}
              color="gray.700"
              fontSize="12px"
            >
              Custom
            </SmallLabel>
            <MenuLink href={`/${project?.slug}/analytics/reports`} paddingX={6}>
              Reports
            </MenuLink>
          </VStack>
        </VStack>
        <Container maxWidth={showFilters ? "1612" : "1200"} padding={6}>
          {children}
        </Container>
      </HStack>
    </DashboardLayout>
  );
}
