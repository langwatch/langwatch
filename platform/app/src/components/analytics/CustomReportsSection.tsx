import {
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowUpRight, Plus } from "lucide-react";
import { BarChart2 } from "react-feather";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { dashboardContextChip } from "~/features/langy/logic/langyContextChips";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isAggregateProjectKind } from "~/server/app-layer/projects/project-kinds";
import { api } from "~/utils/api";
import { Link } from "../ui/link";

/**
 * The analytics overview's Custom Dashboards list: a card per dashboard, or,
 * when the project has none, an invitation to build one.
 */
export function CustomReportsSection({ slug }: { slug: string }) {
  const { project } = useOrganizationTeamProject();
  const dashboardsQuery = api.dashboards.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const dashboards = dashboardsQuery.data ?? [];

  if (dashboards.length === 0 && !dashboardsQuery.isLoading) {
    // An aggregate (ADR-144) keeps no dashboards of its own, so it is not
    // invited to build one, as the sidebar's Add Dashboard is not shown.
    if (isAggregateProjectKind(project?.kind)) return null;
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
      <Grid
        width="full"
        gap={3}
        gridTemplateColumns="repeat(auto-fill, minmax(250px, 1fr))"
      >
        {dashboards.map((dashboard) => (
          // Armed, the dashboard can be handed to Langy; the card still opens
          // the report exactly as before.
          <LangyContextTarget
            key={dashboard.id}
            target={dashboardContextChip({
              dashboardId: dashboard.id,
              name: dashboard.name,
            })}
          >
            <Link
              href={`/${slug}/analytics/reports?dashboard=${dashboard.id}`}
              _hover={{ textDecoration: "none" }}
            >
              <Card.Root
                width="full"
                cursor="pointer"
                borderColor="border"
                _hover={{ borderColor: "orange.400", shadow: "sm" }}
                transition="all 0.15s ease"
              >
                <Card.Body paddingX={4} paddingY={3}>
                  <Flex gap={3} alignItems="center">
                    <Box
                      padding={2}
                      borderRadius="md"
                      bg="orange.subtle"
                      color="orange.fg"
                    >
                      <BarChart2 size={16} />
                    </Box>
                    <VStack align="start" gap={0} flex={1}>
                      <Text fontWeight="500" textStyle="sm">
                        {dashboard.name}
                      </Text>
                      <Text textStyle="xs" color="fg.muted">
                        Custom Dashboard
                      </Text>
                    </VStack>
                    <Box color="fg.subtle" marginLeft="auto">
                      <ArrowUpRight size={14} />
                    </Box>
                  </Flex>
                </Card.Body>
              </Card.Root>
            </Link>
          </LangyContextTarget>
        ))}
      </Grid>
    </>
  );
}
