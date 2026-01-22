import { Container, Heading, HStack, VStack } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { CustomDashboardsSection } from "~/components/analytics/CustomDashboardsSection";
import { DashboardLayout } from "~/components/DashboardLayout";
import { MenuLink } from "~/components/MenuLink";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AnalyticsHeader,
  type AnalyticsHeaderProps,
} from "./analytics/AnalyticsHeader";
import { useFilterToggle } from "./filters/FilterToggle";
import { SmallLabel } from "./SmallLabel";

export default function GraphsLayout({
  children,
  title,
  analyticsHeaderProps,
  extraHeaderButtons,
}: PropsWithChildren<{
  title: string;
  analyticsHeaderProps?: Omit<AnalyticsHeaderProps, "title">;
  extraHeaderButtons?: React.ReactNode;
}>) {
  const { project } = useOrganizationTeamProject();
  const { showFilters } = useFilterToggle();

  return (
    <DashboardLayout>
      <AnalyticsHeader
        title={title}
        {...analyticsHeaderProps}
        extraHeaderButtons={extraHeaderButtons}
      />
      <HStack align="start" width="full" height="full">
        <VStack
          align="start"
          paddingX={2}
          paddingY={4}
          fontSize="14px"
          minWidth="180px"
          height="full"
          gap={1}
        >
          <MenuLink href={`/${project?.slug}`}>Overview</MenuLink>
          <VStack align="start" width="full" gap={1}>
            {/* TODO: reduce font size to 11 once the rest of the page also have a smaller fit */}
            <SmallLabel
              paddingX={4}
              paddingTop={4}
              paddingBottom={2}
              color="fg"
              fontSize="12px"
            >
              Engagement
            </SmallLabel>
            <MenuLink href={`/${project?.slug}/analytics/users`}>
              Users
            </MenuLink>
            <MenuLink href={`/${project?.slug}/analytics/topics`}>
              Topics
            </MenuLink>
          </VStack>
          <VStack align="start" width="full" gap={1}>
            <SmallLabel
              paddingX={4}
              paddingTop={4}
              paddingBottom={2}
              color="fg"
              fontSize="12px"
            >
              Observability
            </SmallLabel>
            <MenuLink href={`/${project?.slug}/analytics/metrics`}>
              LLM Metrics
            </MenuLink>
            <MenuLink href={`/${project?.slug}/analytics/evaluations`}>
              Evaluations
            </MenuLink>
          </VStack>
          <VStack align="start" width="full" gap={1}>
            <SmallLabel
              paddingX={4}
              paddingTop={4}
              paddingBottom={2}
              color="fg"
              fontSize="12px"
            >
              Custom
            </SmallLabel>
            {project?.slug && (
              <CustomDashboardsSection projectSlug={project.slug} />
            )}
          </VStack>
        </VStack>
        <Container maxWidth={showFilters ? "1612" : "1200"} padding={4}>
          {children}
        </Container>
      </HStack>
    </DashboardLayout>
  );
}
