import {
  Card,
  CardBody,
  CardHeader,
  Container,
  HStack,
  Heading,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { CopyInput } from "../components/CopyInput";
import {
  DashboardLayout,
  ProjectSelector,
} from "../components/DashboardLayout";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";

export default function Authorize() {
  const { organizations, project } = useOrganizationTeamProject();

  return (
    <DashboardLayout>
      <Container paddingTop="200px">
        <Card>
          <CardHeader>
            <HStack width="full" align="center">
              <Heading as="h1" size="md">
                Authorize
              </Heading>
              <Spacer />
              {organizations && project && (
                <ProjectSelector
                  organizations={organizations}
                  project={project}
                />
              )}
            </HStack>
          </CardHeader>
          <CardBody>
            <VStack spacing={6}>
              <Text>
                Copy your LangWatch API key below and paste it into your command
                line or notebook to authorize it.
              </Text>
              <APIKeyCopyInput />
            </VStack>
          </CardBody>
        </Card>
      </Container>
    </DashboardLayout>
  );
}

export function APIKeyCopyInput() {
  const { project } = useOrganizationTeamProject();
  return <CopyInput value={project?.apiKey ?? ""} label="API key" />;
}
