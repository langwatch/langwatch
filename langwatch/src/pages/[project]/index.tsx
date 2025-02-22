import { Link } from "../../components/ui/link";
import {
  Alert,
  Box,
  Card,
  HStack,
  Heading,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { GetServerSidePropsContext } from "next";
import { useRouter } from "next/router";
import {
  DocumentsCountsSummary,
  DocumentsCountsTable,
} from "../../components/analytics/DocumentsCountsTable";
import { UserMetrics } from "../../components/analytics/UserMetrics";
import { FilterSidebar } from "../../components/filters/FilterSidebar";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { dependencies } from "../../injection/dependencies.client";
import { dependencies as serverDependencies } from "../../injection/dependencies.server";
import { api } from "../../utils/api";
import GraphsLayout from "../../components/GraphsLayout";
import { AnalyticsHeader } from "../../components/analytics/AnalyticsHeader";
import { LLMMetrics } from "../../components/LLMMetrics";

export default function ProjectRouter() {
  const router = useRouter();

  const path =
    "/" +
    (typeof router.query.project == "string" ? router.query.project : "/");

  const Page = dependencies.extraPagesRoutes?.[path];
  if (Page) {
    return <Page />;
  }

  return Index();
}

export const getServerSideProps = async (
  context: GetServerSidePropsContext
) => {
  const path =
    "/" +
    (typeof context.query.project == "string" ? context.query.project : "/");

  const serverSideProps =
    serverDependencies.extraPagesGetServerSideProps?.[path];
  if (serverSideProps) {
    return serverSideProps(context);
  }

  return {
    props: {},
  };
};

function Index() {
  const { project } = useOrganizationTeamProject();

  const router = useRouter();
  const returnTo = router.query.return_to;
  if (
    typeof returnTo === "string" &&
    (returnTo.startsWith("/") || returnTo.startsWith(window.location.origin))
  ) {
    void router.push(returnTo);
    return null;
  }

  return (
    <GraphsLayout>
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
              <Link href={`/${project.slug}/messages`}>setup</Link>
              <Text as="span"> page to get started.</Text>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      <AnalyticsHeader title="Analytics" />

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
    queryOpts
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
            </Tabs.List>
            <Tabs.Indicator
              mt="-1.5px"
              height="4px"
              bg="orange.400"
              borderRadius="1px"
            />
            <Tabs.Content value="total-documents">
              <DocumentsCountsTable />
            </Tabs.Content>
          </Tabs.Root>
        </Card.Body>
      </Card.Root>
    </>
  );
}
