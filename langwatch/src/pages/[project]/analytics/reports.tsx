import { AddIcon, DeleteIcon } from "@chakra-ui/icons";
import { Link } from "@chakra-ui/next-js";
import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Card,
  CardBody,
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
  VStack,
  useToast,
} from "@chakra-ui/react";
import { BarChart2, MoreVertical } from "react-feather";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { useFilterToggle } from "~/components/filters/FilterToggle";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import GraphsLayout from "~/components/GraphsLayout";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";
import { useRouter } from "next/router";

export default function Reports() {
  const { project } = useOrganizationTeamProject();
  const { showFilters } = useFilterToggle();

  const graphs = api.graphs.getAll.useQuery({ projectId: project?.id ?? "" });
  const deleteGraphs = api.graphs.delete.useMutation();
  const toast = useToast();

  const router = useRouter();

  const deleteGraph = (id: string) => () => {
    deleteGraphs.mutate(
      { projectId: project?.id ?? "", id: id },
      {
        onSuccess: () => {
          void graphs.refetch();
        },
        onError: () => {
          toast({
            title: "Error deleting graph",
            status: "error",
            duration: 3000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  return (
    <GraphsLayout>
      <AnalyticsHeader title="Custom Reports" />
      {graphs.data && graphs.data?.length === 0 && (
        <Alert status="info" variant="left-accent" marginBottom={6}>
          <AlertIcon alignSelf="start" />
          <VStack align="start">
            <AlertTitle>Add your custom graphs here</AlertTitle>
            <AlertDescription>
              <Text as="span">
                You haven{"'"}t set up any custom graphs yet. Click + Add to get
                started.
              </Text>
            </AlertDescription>
          </VStack>
        </Alert>
      )}
      <HStack width="full" paddingBottom={6}>
        {project ? (
          <Link as={Button} href={`/${project.slug}/analytics/custom`}>
            <AddIcon marginRight={2} /> Add chart
          </Link>
        ) : null}
      </HStack>
      <HStack align="start" gap={5}>
        <Grid templateColumns="repeat(2, 1fr)" gap={5} width={"100%"}>
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
                            onClick={() => {
                              void router.push(
                                `/${project?.slug}/analytics/custom/${graph.id}`
                              );
                            }}
                          >
                            Edit Graph
                          </MenuItem>
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
    </GraphsLayout>
  );
}
