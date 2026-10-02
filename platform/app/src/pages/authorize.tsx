import {
  Card,
  Container,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { MintApiKeyBanner } from "../components/api-keys/MintApiKeyBanner";
import { CopyInput } from "../components/CopyInput";
import { DashboardLayout } from "../components/DashboardLayout";
import { ProjectSelector } from "../components/ProjectSelector";
import { useMintProjectApiKey } from "../hooks/useMintProjectApiKey";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { trackEvent } from "../utils/tracking";

/**
 * The page the SDK's `langwatch.login()` sends people to. It mints a
 * personal API key bound to the selected project and shows it once, to be
 * pasted into the command line or notebook.
 */
export default function Authorize() {
  const { organizations, organization, project } = useOrganizationTeamProject();

  return (
    <DashboardLayout>
      <Container maxWidth="600px" paddingTop="200px">
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
            <VStack align="stretch" gap={6}>
              <Text>
                Generate an API key below and paste it into your command line or
                notebook to authorize it.
              </Text>
              {organization && project && (
                // Keyed by project so switching projects never shows a key
                // minted for the previous one.
                <APIKeyMint
                  key={project.id}
                  organizationId={organization.id}
                  projectId={project.id}
                />
              )}
            </VStack>
          </Card.Body>
        </Card.Root>
      </Container>
    </DashboardLayout>
  );
}

function APIKeyMint({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { token, mint, isPending } = useMintProjectApiKey({
    organizationId,
    projectId,
    name: "SDK login",
  });

  return (
    <VStack align="stretch" gap={4}>
      <MintApiKeyBanner
        token={token}
        onMint={mint}
        isPending={isPending}
        hint="for this project."
      />
      {token && (
        <CopyInput
          value={token}
          label="API key"
          onClick={() => trackEvent("api_key_copy", { project_id: projectId })}
        />
      )}
    </VStack>
  );
}
