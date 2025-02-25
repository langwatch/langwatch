import {
  Button,
  Card,
  Container,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import router from "next/router";
import { Play } from "react-feather";

import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { Link } from "~/components/ui/link";
import { Table } from "@chakra-ui/react";

export default function Experiments() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  const experiments = api.experiments.getAllByProjectId.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Experiments
          </Heading>
          <Spacer />
          <Button
            colorPalette="blue"
            onClick={() => {
              openDrawer("batchEvaluation", {
                selectDataset: true,
              });
            }}
            minWidth="fit-content"
          >
            <Play height={16} /> Batch Evaluation
          </Button>
        </HStack>
        <Card.Root>
          <Card.Body>
            {experiments.data && experiments.data.length == 0 ? (
              <NoDataInfoBlock
                title="No experiments yet"
                description="Run batch experiments on your messages to do further analysis"
                docsInfo={
                  <Text>
                    To learn more about experiments and evaluations, please
                    visit our{" "}
                    <Link
                      color="orange.400"
                      href="https://docs.langwatch.ai/evaluations/overview"
                      isExternal
                    >
                      documentation
                    </Link>
                    .
                  </Text>
                }
                icon={<Play />}
              />
            ) : (
              <Table.Root variant="line">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Experiment</Table.ColumnHeader>
                    <Table.ColumnHeader>Type</Table.ColumnHeader>
                    <Table.ColumnHeader>Created At</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {experiments.isLoading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <Table.Row key={i}>
                          {Array.from({ length: 4 }).map((_, i) => (
                            <Table.Cell key={i}>
                              <Skeleton height="20px" />
                            </Table.Cell>
                          ))}
                        </Table.Row>
                      ))
                    : experiments.data
                    ? experiments.data?.map((experiment, i) => (
                        <Table.Row
                          cursor="pointer"
                          onClick={() => {
                            void router.push({
                              pathname: `/${project?.slug}/experiments/${experiment.slug}`,
                            });
                          }}
                          key={i}
                        >
                          <Table.Cell>{experiment.name ?? experiment.slug}</Table.Cell>
                          <Table.Cell>{experiment.type}</Table.Cell>
                          <Table.Cell>{experiment.createdAt.toLocaleString()}</Table.Cell>
                        </Table.Row>
                      ))
                    : null}
                </Table.Body>
              </Table.Root>
            )}
          </Card.Body>
        </Card.Root>
      </Container>
    </DashboardLayout>
  );
}
