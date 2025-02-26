import {
  Container,
  HStack,
  Heading,
  Spacer,
  Text,
  VStack,
  Card,
} from "@chakra-ui/react";
import { CopyInput } from "../components/CopyInput";
import {
  DashboardLayout,
  ProjectSelector,
} from "../components/DashboardLayout";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { trackEvent } from "../utils/tracking";

export default function Authorize() {
  const { organizations, project } = useOrganizationTeamProject();

  return (
    <DashboardLayout>
      <Container paddingTop="200px">
        <Card.Root>
          <Card.Header>
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
          </Card.Header>
          <Card.Body>
            <VStack gap={6}>
              <Text>
                Copy your LangWatch API key below and paste it into your command
                line or notebook to authorize it.
              </Text>
              <APIKeyCopyInput />
            </VStack>
          </Card.Body>
        </Card.Root>
      </Container>
    </DashboardLayout>
  );
}

export function APIKeyCopyInput() {
  const { project } = useOrganizationTeamProject();
  return (
    <CopyInput
      value={project?.apiKey ?? ""}
      label="API key"
      onClick={() => trackEvent("api_key_copy", { project_id: project?.id })}
    />
  );
}
