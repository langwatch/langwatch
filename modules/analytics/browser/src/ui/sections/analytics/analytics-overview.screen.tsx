import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { ArrowUpRight, Plus } from "lucide-react";
import { BarChart2 } from "react-feather";

import { useDashboards } from "../../../behavior/use-dashboards.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { Link } from "../../../ui/elements/analytics-link.tsx";
import AnalyticsLayout from "../../../ui/sections/analytics-layout.tsx";
import { DocumentsMetrics } from "../../../ui/sections/documents-metrics.tsx";
import { FilterSidebar } from "../../../ui/sections/filter-sidebar.tsx";
import { LLMMetrics } from "../../../ui/sections/llm-metrics.tsx";
import { UserMetrics } from "../../../ui/sections/user-metrics.tsx";

function AnalyticsContent() {
  const host = useAnalyticsHost();
  const project = host.project();

  return (
    <AnalyticsLayout tab="overview">
      {/* An aggregate receives no traces of its own (ADR-177), so it is not asked to send any. */}
      {project && !project.hasFirstMessage && !isAggregateProjectKind(project.kind) && (
        <Box marginBottom={6}>
          <Banner
            status="warning"
            title="No traces received yet"
            action={
              <BannerAction asChild>
                <Link href={`/${project.slug}/traces`}>Set up tracing</Link>
              </BannerAction>
            }
          >
            Tracing is not integrated yet, so there is no data to display.
          </Banner>
        </Box>
      )}

      <HStack align="start" width="full" gap={8}>
        <VStack align="start" width="full">
          <UserMetrics />
          <LLMMetrics />
          <DocumentsMetrics />
          {project && <CustomReportsSection slug={project.slug} />}
        </VStack>
        <FilterSidebar hideTopics={true} />
      </HStack>
    </AnalyticsLayout>
  );
}

export function CustomReportsSection({ slug }: { slug: string }) {
  const host = useAnalyticsHost();
  const project = host.project();
  const dashboardsQuery = useDashboards({ projectId: project?.id ?? "" });
  const dashboards = dashboardsQuery.data ?? [];

  if (dashboards.length === 0 && !dashboardsQuery.isLoading) {
    // An aggregate (ADR-177) keeps no dashboards of its own, so it is not invited to build one.
    if (isAggregateProjectKind(project?.kind)) return null;
    return (
      <>
        <Heading as="h2" size="sm" paddingTop={6} paddingBottom={2}>
          Custom Dashboards
        </Heading>
        <Card
          placeholder
          icon={<BarChart2 size={16} />}
          title="Build your own dashboard"
          description="Drag and drop charts to track the metrics that matter most to your team."
          actions={
            <Button asChild size="xs" variant="outline">
              <Link href={`/${slug}/analytics/reports`} _hover={{ textDecoration: "none" }}>
                <Plus size={14} /> Create
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  if (dashboards.length === 0) return null;

  return (
    <>
      <Heading as="h2" size="sm" paddingTop={6} paddingBottom={2}>
        Custom Dashboards
      </Heading>
      <Grid width="full" gap={3} gridTemplateColumns="repeat(auto-fill, minmax(250px, 1fr))">
        {dashboards.map((dashboard) => (
          <Card
            key={dashboard.id}
            padding="none"
            opener={
              <Link
                href={`/${slug}/analytics/reports?dashboard=${dashboard.id}`}
                aria-label={`Open ${dashboard.name}`}
                _hover={{ textDecoration: "none" }}
              />
            }
          >
            <Flex gap={3} alignItems="center" paddingX={4} paddingY={3}>
              <Box padding={2} borderRadius="md" bg="orange.subtle" color="orange.fg">
                <BarChart2 size={16} />
              </Box>
              <VStack align="start" gap={0} flex={1}>
                <Text fontWeight="500" textStyle="sm">
                  {dashboard.name}
                </Text>
                <Text textStyle="xs" color="fg.muted">
                  Custom Dashboard
                </Text>
              </VStack>
              <Box color="fg.subtle" marginLeft="auto">
                <ArrowUpRight size={14} />
              </Box>
            </Flex>
          </Card>
        ))}
      </Grid>
    </>
  );
}

/**
 * The page guard is the routes section's, not this module's: the
 * `analytics:view` permission and layout chrome are stated once in
 * `analytics-routes.tsx`, in front of the same loader registry.
 */
export default AnalyticsContent;
