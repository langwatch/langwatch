import { Link } from "../../components/ui/link";
import {
  Box,
  Center,
  Container,
  Grid,
  Heading,
  HStack,
  Skeleton,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Lock, Plus } from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { IntroducingStudio } from "../../components/IntroducingStudio";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { NewWorkflowModal } from "../../optimization_studio/components/workflow/NewWorkflowModal";
import {
  WorkflowCard,
  WorkflowCardBase,
} from "../../optimization_studio/components/workflow/WorkflowCard";
import { Tooltip } from "../../components/ui/tooltip";

import { api } from "../../utils/api";
import { trackEvent } from "../../utils/tracking";

export default function Workflows() {
  const { project, isOrganizationFeatureEnabled, organization } =
    useOrganizationTeamProject();

  const { open, onClose, onOpen } = useDisclosure();

  const workflows = api.workflow.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const usage = api.limits.getUsage.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  );

  const canCreateWorkflow =
    (!!usage.data?.activePlan.maxWorkflows &&
      (workflows.data?.length ?? 0) < usage.data.activePlan.maxWorkflows) ||
    isOrganizationFeatureEnabled("OPTIMIZATION_STUDIO");

  return (
    <DashboardLayout>
      <Container maxWidth="1200px" padding={6}>
        <VStack gap={8} width="full" align="start">
          <HStack align="center" gap={6}>
            <Heading as={"h1"} size="lg" paddingTop={1}>
              Optimization Studio Workflows
            </Heading>
          </HStack>
          <Grid
            templateColumns="repeat(auto-fill, minmax(260px, 1fr))"
            gap={6}
            width="full"
          >
            {!canCreateWorkflow ? (
              <WorkflowCardBase opacity={0.5}>
                <Tooltip content="You reached the limit of max workflows, click to upgrade your plan to add more workflows">
                  <Center width="full" height="full">
                    <Link
                      href={`/settings/subscription`}
                      _hover={{
                        textDecoration: "none",
                      }}
                      onClick={() => {
                        trackEvent("subscription_hook_click", {
                          project_id: project?.id,
                          hook: "studio_workflow_limit_reached",
                        });
                      }}
                    >
                      <HStack gap={3}>
                        <Lock size={14} color="#777" />

                        <Text fontSize="18px" color="gray.600">
                          Create new
                        </Text>
                      </HStack>
                    </Link>
                  </Center>
                </Tooltip>
              </WorkflowCardBase>
            ) : (
              <WorkflowCardBase
                // This lets us test the happy path for prompt management from workflow
                // since otherwise both versions look the same, but we need to wait
                // for this one to be clickable
                data-testid="active-create-new-workflow-button"
                onClick={onOpen}
              >
                <Center width="full" height="full">
                  <HStack gap={3}>
                    <Box
                      borderRadius="full"
                      border="2px solid"
                      borderColor="#999"
                      padding={1}
                    >
                      <Plus size={14} color="#777" />
                    </Box>

                    <Text fontSize="18px" color="gray.500">
                      Create new
                    </Text>
                  </HStack>
                </Center>
              </WorkflowCardBase>
            )}
            {workflows.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="200px" />
              ))}
            {workflows.data?.map((workflow) => (
              <Link
                href={`/${project?.slug}/studio/${workflow.id}`}
                key={workflow.id}
                display="block"
                asChild
              >
                <WorkflowCard
                  workflowId={workflow.id}
                  query={workflows}
                  name={workflow.name}
                  icon={workflow.icon}
                  description={workflow.description}
                  onClick={(e) => {
                    let target = e.target as HTMLElement;
                    while (target.parentElement) {
                      if (target.classList.contains("js-inner-menu")) {
                        e.stopPropagation();
                        e.preventDefault();
                        return false;
                      }
                      target = target.parentElement;
                    }
                  }}
                />
              </Link>
            ))}
          </Grid>
        </VStack>
      </Container>
      <NewWorkflowModal open={open} onClose={onClose} />
    </DashboardLayout>
  );
}
