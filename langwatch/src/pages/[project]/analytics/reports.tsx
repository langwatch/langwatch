import {
  Alert,
  Box,
  Button,
  Card,
  Grid,
  GridItem,
  HStack,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  BarChart2,
  Edit,
  Filter,
  MoreVertical,
  Plus,
  Trash2,
} from "react-feather";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { useFilterToggle } from "~/components/filters/FilterToggle";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FilterField } from "~/server/filters/types";
import { api } from "~/utils/api";
import { Link } from "../../../components/ui/link";

import { useRouter } from "next/router";
import { useMemo } from "react";
import GraphsLayout from "~/components/GraphsLayout";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { FilterDisplay } from "~/components/triggers/FilterDisplay";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";

interface GraphCardProps {
  graph: {
    id: string;
    name: string;
    graph: unknown;
    filters: unknown;
  };
  projectSlug: string;
  onDelete: () => void;
  isDeleting: boolean;
}

/**
 * Single Responsibility: Renders a single graph card with filters and actions
 */
function GraphCard({
  graph,
  projectSlug,
  onDelete,
  isDeleting,
}: GraphCardProps) {
  const router = useRouter();

  const hasFilters = useMemo(
    () =>
      !!(
        graph.filters &&
        typeof graph.filters === "object" &&
        Object.keys(graph.filters).length > 0
      ),
    [graph.filters]
  );

  return (
    <GridItem key={graph.id} display={"inline-grid"}>
      <Card.Root>
        <Card.Body>
          <HStack align={"top"} marginBottom={4}>
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
            {hasFilters && (
              <Tooltip
                content={
                  <VStack
                    align="start"
                    backgroundColor="black"
                    color="white"
                    height="100%"
                    textWrap="wrap"
                  >
                    <FilterDisplay
                      filters={
                        graph.filters as Record<
                          FilterField,
                          string[] | Record<string, string[]>
                        >
                      }
                    />
                  </VStack>
                }
                positioning={{ placement: "top" }}
                showArrow
              >
                <Box padding={1}>
                  <Filter width={16} style={{ minWidth: 16 }} />
                </Box>
              </Tooltip>
            )}
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="ghost" loading={isDeleting}>
                  <MoreVertical />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item
                  value="edit"
                  onClick={() => {
                    void router.push(
                      `/${projectSlug}/analytics/custom/${graph.id}`
                    );
                  }}
                >
                  <Edit /> Edit Graph
                </Menu.Item>
                <Menu.Item value="delete" color="red.600" onClick={onDelete}>
                  <Trash2 /> Delete Graph
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </HStack>
          <CustomGraph
            key={graph.id}
            input={graph.graph as CustomGraphInput}
            filters={
              graph.filters as
                | Record<FilterField, string[] | Record<string, string[]>>
                | undefined
            }
          />
        </Card.Body>
      </Card.Root>
    </GridItem>
  );
}

export default function Reports() {
  const { project } = useOrganizationTeamProject();
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
          toaster.create({
            title: "Error deleting graph",
            type: "error",
            duration: 3000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
      }
    );
  };

  return (
    <GraphsLayout>
      <AnalyticsHeader title="Custom Reports" />
      {graphs.data && graphs.data?.length === 0 && (
        <Alert.Root
          status="info"
          borderStartWidth="4px"
          borderStartColor="colorPalette.solid"
          marginBottom={6}
        >
          <Alert.Indicator alignSelf="start" />
          <VStack align="start">
            <Alert.Title>Add your custom graphs here</Alert.Title>
            <Alert.Description>
              <Text as="span">
                You haven{"'"}t set up any custom graphs yet. Click + Add to get
                started.
              </Text>
            </Alert.Description>
          </VStack>
        </Alert.Root>
      )}
      <HStack width="full" paddingBottom={6}>
        {project ? (
          <Link href={`/${project.slug}/analytics/custom`}>
            <Plus /> Add chart
          </Link>
        ) : null}
      </HStack>
      <HStack align="start" gap={6} width="full">
        <Grid
          templateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }}
          gap={5}
          width={"100%"}
        >
          {graphs.data ? (
            graphs.data.map((graph) => (
              <GraphCard
                key={graph.id}
                graph={graph}
                projectSlug={project?.slug ?? ""}
                onDelete={deleteGraph(graph.id)}
                isDeleting={
                  deleteGraphs.isLoading &&
                  deleteGraphs.variables?.id === graph.id
                }
              />
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
