import {
  Alert,
  Box,
  Button,
  Card,
  Grid,
  Heading,
  HStack,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowUpRight, Plus } from "lucide-react";
import { BarChart2 } from "react-feather";
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
import { useFilterParams } from "../../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";

function AnalyticsContent() {
  const { project } = useOrganizationTeamProject();

  return (
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
          {project && <CustomReportsSection slug={project.slug} />}
        </VStack>
        <FilterSidebar hideTopics={true} />
      </HStack>
    </GraphsLayout>
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
        <Heading as="h2" size="md" paddingTop={6} paddingBottom={2}>
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
                  <Text color="fg">Total documents</Text>
                  <Box textStyle="2xl" color="fg" fontWeight="bold">
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

function CustomReportsSection({ slug }: { slug: string }) {
  const { project } = useOrganizationTeamProject();
  const dashboardsQuery = api.dashboards.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const dashboards = dashboardsQuery.data ?? [];

  if (dashboards.length === 0 && !dashboardsQuery.isLoading) {
    return (
      <>
        <Heading as="h2" size="md" paddingTop={6} paddingBottom={2}>
          Custom Dashboards
        </Heading>
        <Card.Root borderStyle="dashed">
          <Card.Body padding={5}>
            <HStack gap={4}>
              <Box color="fg.subtle">
                <BarChart2 size={20} />
              </Box>
              <VStack align="start" gap={1} flex={1}>
                <Text textStyle="sm" fontWeight="500">
                  Build your own dashboard
                </Text>
                <Text textStyle="xs" color="fg.muted">
                  Drag and drop charts to track the metrics that matter most to
                  your team.
                </Text>
              </VStack>
              <Link
                href={`/${slug}/analytics/reports`}
                _hover={{ textDecoration: "none" }}
              >
                <Button size="sm" variant="outline">
                  <Plus size={14} /> Create
                </Button>
              </Link>
            </HStack>
          </Card.Body>
        </Card.Root>
      </>
    );
  }

  if (dashboards.length === 0) return null;

  return (
    <>
      <Heading as="h2" size="md" paddingTop={6} paddingBottom={2}>
        Custom Dashboards
      </Heading>
      <HStack width="full" gap={3} flexWrap="wrap">
        {dashboards.map((dashboard) => (
          <Link
            key={dashboard.id}
            href={`/${slug}/analytics/reports?dashboard=${dashboard.id}`}
            _hover={{ textDecoration: "none" }}
          >
            <Card.Root
              cursor="pointer"
              borderColor="border"
              _hover={{ borderColor: "orange.400", shadow: "sm" }}
              transition="all 0.15s ease"
            >
              <Card.Body paddingX={4} paddingY={3}>
                <HStack gap={3}>
                  <Box
                    padding={2}
                    borderRadius="md"
                    bg="orange.subtle"
                    color="orange.fg"
                  >
                    <BarChart2 size={16} />
                  </Box>
                  <VStack align="start" gap={0}>
                    <Text fontWeight="500" textStyle="sm">
                      {dashboard.name}
                    </Text>
                    <Text textStyle="xs" color="fg.muted">
                      Custom Dashboard
                    </Text>
                  </VStack>
                  <Box color="fg.subtle">
                    <ArrowUpRight size={14} />
                  </Box>
                </HStack>
              </Card.Body>
            </Card.Root>
          </Link>
        ))}
      </HStack>
    </>
  );
}

export default withPermissionGuard("analytics:view", {
  layoutComponent: DashboardLayout,
})(AnalyticsContent);
