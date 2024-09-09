import {
  Center,
  Container,
  Grid,
  Heading,
  HStack,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { NewWorkflowModal } from "../../optimization_studio/components/workflow/NewWorkflowModal";
import { WorkflowCardBase } from "../../optimization_studio/components/workflow/WorkflowCard";

export default function MessagesOrIntegrationGuide() {
  const { project } = useOrganizationTeamProject();

  const { isOpen, onClose, onOpen } = useDisclosure();

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
                <HStack>
                  <Plus size={24} />
                  <Heading as={"h2"} size="md" fontWeight={500}>
                    Create new
                  </Heading>
                </HStack>
              </Center>
            </WorkflowCardBase>
          </Grid>
        </VStack>
      </Container>
      <NewWorkflowModal isOpen={isOpen} onClose={onClose} />
    </DashboardLayout>
  );
}
