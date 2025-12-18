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
import { useRouter } from "next/router";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import {
  BarChart2,
  Bell,
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
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { useFilterToggle } from "~/components/filters/FilterToggle";
import GraphsLayout from "~/components/GraphsLayout";
import { FilterDisplay } from "~/components/triggers/FilterDisplay";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import type { FilterField } from "~/server/filters/types";
import { api } from "~/utils/api";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";
import { Link } from "../../../components/ui/link";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import {
  customGraphInputToFormData,
  type CustomGraphFormData,
} from "./custom/index";

interface GraphCardProps {
  graph: {
    id: string;
    name: string;
    graph: unknown;
    filters: unknown;
    trigger?: {
      id: string;
      active: boolean;
      alertType: string | null;
    } | null;
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
  const { openDrawer } = useDrawer();

  // Create form instance from graph data for the alert drawer
  const form = useForm<CustomGraphFormData>({
    defaultValues: graph.graph
      ? customGraphInputToFormData(graph.graph as CustomGraphInput)
      : undefined,
  });

  const hasFilters = useMemo(
    () =>
      !!(
        graph.filters &&
        typeof graph.filters === "object" &&
        Object.keys(graph.filters).length > 0
      ),
    [graph.filters],
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
            {graph.trigger && graph.trigger.active ? (
              <Tooltip
                content={`Alert configured (${
                  graph.trigger.alertType ?? "INFO"
                })`}
                positioning={{ placement: "top" }}
                showArrow
              >
                <Box padding={1}>
                  <Bell
                    width={18}
                    color="black"
                    cursor="pointer"
                    onClick={() =>
                      openDrawer("customGraphAlert", {
                        form,
                        graphId: graph.id,
                      })
                    }
                  />
                </Box>
              </Tooltip>
            ) : (
              <Button
                variant="outline"
                colorPalette="gray"
                size="sm"
                onClick={() =>
                  openDrawer("customGraphAlert", {
                    form,
                    graphId: graph.id,
                  })
                }
              >
                <Bell width={16} />
                Add alert
              </Button>
            )}
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
                      `/${projectSlug}/analytics/custom/${graph.id}`,
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

function ReportsContent() {
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
          });
        },
      },
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

export default withPermissionGuard("analytics:view", {
  layoutComponent: GraphsLayout,
})(ReportsContent);
