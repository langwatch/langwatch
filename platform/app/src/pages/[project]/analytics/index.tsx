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
import { useMemo } from "react";
import { withAggregateAnalyticsGate } from "~/components/analytics/AggregateAnalyticsGate";
import { CustomReportsSection } from "~/components/analytics/CustomReportsSection";
import {
  DocumentsCountsSummary,
  DocumentsCountsTable,
} from "../../../components/analytics/DocumentsCountsTable";
import { UserMetrics } from "../../../components/analytics/UserMetrics";
import { useTopUsedDocuments } from "../../../components/analytics/useTopUsedDocuments";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { FilterSidebar } from "../../../components/filters/FilterSidebar";
import GraphsLayout from "../../../components/GraphsLayout";
import { LLMMetrics } from "../../../components/LLMMetrics";
import { Link } from "../../../components/ui/link";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { useFilterParams } from "../../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";

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
              <Link textDecoration="underline" href={`/${project.slug}/traces`}>
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
  const params = useMemo(
    () => ({ filterParams, queryOpts }),
    [filterParams, queryOpts],
  );
  const documents = useTopUsedDocuments(params);

  const count = documents.data?.totalUniqueDocuments;

  // A failed query says nothing about whether there are documents, so the
  // section stays up and its panels show the error with a Retry.
  if (!documents.error && (!count || count === 0)) {
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
                    <DocumentsCountsSummary params={params} />
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
              <DocumentsCountsTable params={params} />
            </Tabs.Content>
          </Tabs.Root>
        </Card.Body>
      </Card.Root>
    </>
  );
}

export default withPermissionGuard("analytics:view", {
  layoutComponent: DashboardLayout,
})(withAggregateAnalyticsGate("Analytics", AnalyticsContent));
