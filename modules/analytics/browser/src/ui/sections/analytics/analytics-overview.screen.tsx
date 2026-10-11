import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { MetricTabs } from "@langwatch/design-system/metric-tabs";
import {
  Box,
  Button,
  Card as LinkCard,
  Flex,
  Grid,
  Heading,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { ArrowUpRight, Plus } from "lucide-react";
import { useMemo } from "react";
import { BarChart2 } from "react-feather";

import { useTopUsedDocuments } from "../../../behavior/use-analytics-documents.ts";
import { useDashboards } from "../../../behavior/use-dashboards.ts";
import { useFilterParams } from "../../../behavior/use-filter-params.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { Link } from "../../../ui/elements/analytics-link.tsx";
import AnalyticsLayout from "../../../ui/sections/analytics-layout.tsx";
import {
  DocumentsCountsSummary,
  DocumentsCountsTable,
} from "../../../ui/sections/documents-counts-table.tsx";
import { FilterSidebar } from "../../../ui/sections/filter-sidebar.tsx";
import { LLMMetrics } from "../../../ui/sections/llm-metrics.tsx";
import { UserMetrics } from "../../../ui/sections/user-metrics.tsx";
import { withAggregateAnalyticsGate } from "../aggregate-analytics-gate.tsx";

function AnalyticsContent() {
  const host = useAnalyticsHost();
  const project = host.project();

  return (
    <AnalyticsLayout tab="overview">
      {project && !project.hasFirstMessage && (
        <Box marginBottom={6}>
          <Banner
            status="warning"
            title="No traces received yet"
            action={
              <BannerAction asChild>
                <a href={`/${project.slug}/traces`}>Set up tracing</a>
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

/** The documents section has one metric, so there is no other tab to select. */
function keepOnlyTab() {}

function DocumentsMetrics() {
  const { filterParams, queryOpts } = useFilterParams();
  const params = useMemo(() => ({ filterParams, queryOpts }), [filterParams, queryOpts]);
  const documents = useTopUsedDocuments(params);

  const count = documents.data?.totalUniqueDocuments;

  // A failed query says nothing about whether there are documents, so the section stays up
  // and its panels show the error with a Retry.
  if (!documents.error && (!count || count === 0)) {
    return null;
  }

  return (
    <>
      <HStack width="full" align="top">
        <Heading as="h2" size="sm" paddingTop={6} paddingBottom={2}>
          Documents
        </Heading>
      </HStack>
      <Card padding="lg">
        <MetricTabs
          value="total-documents"
          onValueChange={keepOnlyTab}
          label="Documents"
          items={[
            {
              value: "total-documents",
              label: "Total documents",
              figure: <DocumentsCountsSummary params={params} />,
              content: <DocumentsCountsTable params={params} />,
            },
          ]}
        />
      </Card>
    </>
  );
}

function CustomReportsSection({ slug }: { slug: string }) {
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
        <LinkCard.Root borderStyle="dashed">
          <LinkCard.Body padding={5}>
            <HStack gap={4}>
              <Box color="fg.subtle">
                <BarChart2 size={20} />
              </Box>
              <VStack align="start" gap={1} flex={1}>
                <Text textStyle="sm" fontWeight="500">
                  Build your own dashboard
                </Text>
                <Text textStyle="xs" color="fg.muted">
                  Drag and drop charts to track the metrics that matter most to your team.
                </Text>
              </VStack>
              <Link href={`/${slug}/analytics/reports`} _hover={{ textDecoration: "none" }}>
                <Button size="sm" variant="outline">
                  <Plus size={14} /> Create
                </Button>
              </Link>
            </HStack>
          </LinkCard.Body>
        </LinkCard.Root>
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
          <Link
            key={dashboard.id}
            href={`/${slug}/analytics/reports?dashboard=${dashboard.id}`}
            _hover={{ textDecoration: "none" }}
          >
            <LinkCard.Root
              width="full"
              cursor="pointer"
              borderColor="border"
              _hover={{ borderColor: "orange.emphasized", shadow: "sm" }}
              transition="all 0.15s ease"
            >
              <LinkCard.Body paddingX={4} paddingY={3}>
                <Flex gap={3} alignItems="center">
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
              </LinkCard.Body>
            </LinkCard.Root>
          </Link>
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
export default withAggregateAnalyticsGate("Analytics", AnalyticsContent);
