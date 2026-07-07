import {
  Box,
  Container,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { LuSquareCheckBig } from "react-icons/lu";
import { NewEvaluationMenu } from "~/components/evaluations/NewEvaluationMenu";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { Link } from "~/components/ui/link";
import { DashboardLayout } from "../../components/DashboardLayout";
import { MonitorsSection } from "../../components/evaluations/MonitorsSection";
import { PageLayout } from "../../components/ui/layouts/PageLayout";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

function EvaluationsPage() {
  const { project, hasPermission } = useOrganizationTeamProject();
  const [newEvaluationMenuOpen, setNewEvaluationMenuOpen] = useState(false);

  const monitors = api.monitors.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project },
  );

  if (!project) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Evaluations</PageLayout.Heading>
        <Spacer />
        <HStack gap={2}>
          <NewEvaluationMenu
            mode="onlineEvaluations"
            open={newEvaluationMenuOpen}
            onOpenChange={setNewEvaluationMenuOpen}
          />
        </HStack>
      </PageLayout.Header>
      {monitors.isLoading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <Spinner />
        </Box>
      ) : monitors.isError ? (
        <Box padding={6}>
          <Text color="red.500">Error loading online evaluations</Text>
        </Box>
      ) : monitors.data?.length === 0 ? (
        <PageLayout.Container>
          <PageLayout.Content>
            <NoDataInfoBlock
              title="No online evaluations yet"
              description="Create online evaluations to monitor live traces and set up guardrails for production traffic."
              icon={<LuSquareCheckBig size={24} />}
              color="green.500"
              docsInfo={
                <Text>
                  To learn more about online evaluations, please visit our{" "}
                  <Link
                    color="green.500"
                    href="https://langwatch.ai/docs/evaluations/online-evaluation/overview"
                    isExternal
                  >
                    documentation
                  </Link>
                  .
                </Text>
              }
            >
              {hasPermission("evaluations:manage") && (
                <PageLayout.HeaderButton
                  onClick={() => setNewEvaluationMenuOpen(true)}
                  marginTop={4}
                >
                  <Plus size={16} /> Create your first online evaluation
                </PageLayout.HeaderButton>
              )}
            </NoDataInfoBlock>
          </PageLayout.Content>
        </PageLayout.Container>
      ) : (
        <Container
          maxW={"calc(min(1440px, 100vw - 200px))"}
          paddingX={6}
          paddingTop={4}
        >
          <VStack width="fill" gap={4} align="stretch">
            <VStack align="start" gap={1}>
              <Heading as="h1">Online Evaluations</Heading>
              <Text color="fg.muted">
                Monitor live traces and enforce guardrails in production
              </Text>
            </VStack>

            <MonitorsSection title="Online Evaluations" monitors={monitors} />
          </VStack>
        </Container>
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("evaluations:view", {
  layoutComponent: DashboardLayout,
})(EvaluationsPage);
