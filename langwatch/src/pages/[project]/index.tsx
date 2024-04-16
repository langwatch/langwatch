import { Link } from "@chakra-ui/next-js";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Card,
  CardBody,
  HStack,
  Heading,
  Tab,
  TabIndicator,
  TabList,
  TabPanel,
  TabPanels,
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

import GraphsLayout from "~/components/GraphsLayout";
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

  return (
    <GraphsLayout>
      {project && !project.firstMessage && (
        <Alert status="warning" variant="left-accent" marginBottom={6}>
          <AlertIcon alignSelf="start" />
          <VStack align="start">
            <AlertTitle>Setup pending</AlertTitle>
            <AlertDescription>
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
            </AlertDescription>
          </VStack>
        </Alert>
      )}
      <AnalyticsHeader title="Analytics" />

      <HStack align="start" width="full" spacing={8}>
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
        <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={10}>
          Documents
        </Heading>
      </HStack>
      <Card>
        <CardBody>
          <Tabs variant="unstyled">
            <TabList gap={12}>
              <Tab paddingX={0} paddingBottom={4}>
                <VStack align="start">
                  <Text color="black">Total documents</Text>
                  <Box fontSize={24} color="black" fontWeight="bold">
                    <DocumentsCountsSummary />
                  </Box>
                </VStack>
              </Tab>
            </TabList>
            <TabIndicator
              mt="-1.5px"
              height="4px"
              bg="orange.400"
              borderRadius="1px"
            />
            <TabPanels>
              <TabPanel paddingX={0}>
                <DocumentsCountsTable />
              </TabPanel>
            </TabPanels>
          </Tabs>
        </CardBody>
      </Card>
    </>
  );
}
