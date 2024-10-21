import { Link } from "@chakra-ui/next-js";
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
import { Plus } from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { BookAMeeting } from "../../components/BookAMeeting";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { NewWorkflowModal } from "../../optimization_studio/components/workflow/NewWorkflowModal";
import {
  WorkflowCard,
  WorkflowCardBase,
} from "../../optimization_studio/components/workflow/WorkflowCard";

import { api } from "../../utils/api";
import { useEffect } from "react";

export default function MessagesOrIntegrationGuide() {
  const { project } = useOrganizationTeamProject();

  const { isOpen, onClose, onOpen } = useDisclosure();

  const workflows = api.workflow.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  if (true) {
    return (
      <DashboardLayout>
        <Container maxWidth="1200px" padding={6}>
          <BookAMeeting />
        </Container>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Container maxWidth="1200px" padding={6}>
        <VStack spacing={8} width="full" align="start">
          <HStack align="center" spacing={6}>
            <Heading as={"h1"} size="lg" paddingTop={1}>
              Optimization Studio Workflows
            </Heading>
          </HStack>
          <Grid
            templateColumns="repeat(auto-fill, minmax(260px, 1fr))"
            gap={6}
            width="full"
          >
            <WorkflowCardBase onClick={onOpen}>
              <Center width="full" height="full">
                <HStack spacing={3}>
                  <Box
                    borderRadius="full"
                    border="2px solid"
                    borderColor="#999"
                    padding={1}
                  >
                    <Plus size={20} color="#777" />
                  </Box>
                  <Text fontSize={18} color="gray.500">
                    Create new
                  </Text>
                </HStack>
              </Center>
            </WorkflowCardBase>
            {workflows.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} height="200px" />
              ))}
            {workflows.data?.map((workflow) => (
              <WorkflowCard
                as={Link}
                href={`/${project?.slug}/studio/${workflow.id}`}
                key={workflow.id}
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
            ))}
          </Grid>
        </VStack>
      </Container>
      <NewWorkflowModal isOpen={isOpen} onClose={onClose} />
    </DashboardLayout>
  );
}
