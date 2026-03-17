import {
  Alert,
  Box,
  Card,
  Heading,
  HStack,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  DocumentsCountsSummary,
  DocumentsCountsTable,
} from "../../../components/analytics/DocumentsCountsTable";
import { UserMetrics } from "../../../components/analytics/UserMetrics";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { FilterSidebar } from "../../../components/filters/FilterSidebar";
import GraphsLayout from "../../../components/GraphsLayout";
import { LLMMetrics } from "../../../components/LLMMetrics";
import { Link } from "../../../components/ui/link";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import {
  FilterDefaultsProvider,
  useFilterParams,
  type FilterParam,
} from "../../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type { FilterField } from "../../../server/filters/types";
import { api } from "../../../utils/api";

/**
 * Default filter for the analytics overview page: show only application traces.
 * This excludes simulation, evaluation, and playground traces from summary
 * cards and graphs. The filter-translator already treats empty/NULL origin
 * as "application" for backward compatibility with pre-March 7 traces.
 */
const ANALYTICS_DEFAULT_FILTERS: Partial<Record<FilterField, FilterParam>> = {
  "traces.origin": ["application"],
};

function AnalyticsContent() {
  const { project } = useOrganizationTeamProject();

  return (
    <FilterDefaultsProvider defaults={ANALYTICS_DEFAULT_FILTERS}>
      <GraphsLayout title="Analytics">
        {project && !project.firstMessage && (
          <Alert.Root status="warning" marginBottom={6}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>No traces received yet</Alert.Title>
              <Alert.Description>
                <Text as="span">
                  {
                    "Tracing is not integrated yet, so there's no data to display. Go to the "
                  }
                </Text>
                <Link
                  textDecoration="underline"
                  href={`/${project.slug}/messages`}
                >
                  setup
                </Link>
                <Text as="span"> page to get started.</Text>
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}

        <HStack align="start" width="full" gap={8}>
          <VStack align="start" width="full">
            <UserMetrics />
            <LLMMetrics />
            <DocumentsMetrics />
          </VStack>
          <FilterSidebar hideTopics={true} />
        </HStack>
      </GraphsLayout>
    </FilterDefaultsProvider>
  );
}

function DocumentsMetrics() {
  const { filterParams, queryOpts } = useFilterParams();
  const documents = api.analytics.topUsedDocuments.useQuery(
    filterParams,
    queryOpts,
  );

  const count = documents.data?.totalUniqueDocuments;

  if (!count || count === 0) {
    return null;
  }

  return (
    <>
      <HStack width="full" align="top">
        <Heading as="h1" size="lg" paddingTop={6} paddingBottom={2}>
          Documents
        </Heading>
      </HStack>
      <Card.Root width="full">
        <Card.Body>
          <Tabs.Root variant="plain" defaultValue="total-documents">
            <Tabs.List gap={12}>
              <Tabs.Trigger
                value="total-documents"
                paddingX={0}
                paddingBottom={4}
              >
                <VStack align="start">
                  <Text color="black">Total documents</Text>
                  <Box fontSize="24px" color="black" fontWeight="bold">
                    <DocumentsCountsSummary />
                  </Box>
                </VStack>
              </Tabs.Trigger>
              <Tabs.Indicator
                mt="-1.5px"
                height="4px"
                bg="orange.400"
                borderRadius="1px"
                bottom={0}
              />
            </Tabs.List>
            <Tabs.Content value="total-documents">
              <DocumentsCountsTable />
            </Tabs.Content>
          </Tabs.Root>
        </Card.Body>
      </Card.Root>
    </>
  );
}

export default withPermissionGuard("analytics:view", {
  layoutComponent: DashboardLayout,
})(AnalyticsContent);
