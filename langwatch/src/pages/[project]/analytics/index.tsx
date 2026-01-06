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
            <Alert.Title>Setup pending</Alert.Title>
            <Alert.Description>
              <Text as="span">
                {
                  "Your project is not set up yet so you won't be able to see any data on the dashboard, please go to the "
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
