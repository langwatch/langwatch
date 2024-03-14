import { AddIcon, DeleteIcon } from "@chakra-ui/icons";
import { Link } from "@chakra-ui/next-js";
import {
  Button,
  Card,
  CardBody,
  Container,
  Flex,
  Grid,
  GridItem,
  HStack,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Skeleton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { MoreVertical, BarChart2 } from "react-feather";
import { PeriodSelector, usePeriodSelector } from "~/components/PeriodSelector";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import {
  FilterToggle,
  useFilterToggle,
} from "~/components/filters/FilterToggle";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import GraphsLayout from "~/components/GraphsLayout";
import { FilterSidebar } from "~/components/filters/FilterSidebar";

export default function Reports() {
  const { project } = useOrganizationTeamProject();
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();
  const { showFilters } = useFilterToggle();

  const graphs = api.graphs.getAll.useQuery({ projectId: project?.id ?? "" });
  const deleteGraphs = api.graphs.delete.useMutation();

  const deleteGraph = (id: string) => () => {
    deleteGraphs.mutate(
      { projectId: project?.id ?? "", id: id },
      {
        onSuccess: () => {
          void graphs.refetch();
        },
        onError: () => {
          alert("Error deleting graph");
        },
      }
    );
  };

  return (
    <GraphsLayout>
      <Container maxWidth={showFilters ? "1300" : "1200"} padding={6}>
        <HStack width="full" marginBottom={3}>
          {project ? (
            <Link href={`/${project.slug}/analytics/custom`}>
              <AddIcon marginRight={2} /> Add chart
            </Link>
          ) : null}
          <Spacer />
          <FilterToggle />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
        </HStack>
        <hr />

        <HStack align="start" gap={5}>
          <Grid
            templateColumns="repeat(2, 1fr)"
            gap={5}
            marginTop={4}
            width={"100%"}
          >
            {graphs.data ? (
              graphs.data.map((graph) => (
                <GridItem key={graph.id} display={"inline-grid"}>
                  <Card key={graph.id}>
                    <CardBody key={graph.id}>
                      <Flex align={"top"} marginBottom={4}>
                        <BarChart2 color="orange" />
                        <Text
                          marginLeft={2}
                          fontSize="md"
                          fontWeight="bold"
                          marginBottom={2}
                        >
                          {graph.name}
                        </Text>
                        <Spacer />
                        <Menu>
                          <MenuButton
                            as={Button}
                            variant={"ghost"}
                            isLoading={
                              deleteGraphs.isLoading &&
                              deleteGraphs.variables?.id === graph.id
                            }
                          >
                            <MoreVertical />
                          </MenuButton>
                          <MenuList>
                            <MenuItem
                              color="red.600"
                              onClick={deleteGraph(graph.id)}
                              icon={<DeleteIcon />}
                            >
                              Delete Graph
                            </MenuItem>
                          </MenuList>
                        </Menu>
                      </Flex>
                      <CustomGraph
                        key={graph.id}
                        input={graph.graph as CustomGraphInput}
                      />
                    </CardBody>
                  </Card>
                </GridItem>
              ))
            ) : (
              <Skeleton height="20px" />
            )}
          </Grid>
          {showFilters ? <FilterSidebar /> : null}
        </HStack>
      </Container>
    </GraphsLayout>
  );
}
