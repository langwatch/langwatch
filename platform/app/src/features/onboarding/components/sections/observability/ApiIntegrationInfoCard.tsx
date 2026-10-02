import { Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { ApiKeyIntegrationInfoCard } from "~/features/traces-v2/onboarding/components/ApiKeyIntegrationInfoCard";
import { useActiveProject } from "../../../contexts/ActiveProjectContext";

/**
 * The integration info for the onboarding observability screen: one minted
 * access token plus the project id and, when self-hosted, the endpoint. The
 * token is lifted into the onboarding context so every snippet on the screen
 * fills from the same key.
 */
export function ApiIntegrationInfoCard(): React.ReactElement | null {
  const { project, organization, freshToken, onFreshToken } =
    useActiveProject();

  if (!project || !organization) return null;

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0.5}>
        <Text fontSize="md" fontWeight="semibold" letterSpacing="-0.01em">
          Your LangWatch Integration Info
        </Text>
        <Text fontSize="xs" color="fg.muted" lineHeight="tall">
          Manage your API keys anytime in Settings.
        </Text>
      </VStack>
      <ApiKeyIntegrationInfoCard
        organizationId={organization.id}
        projectId={project.id}
        token={freshToken ?? null}
        onTokenGenerated={(token) => onFreshToken?.(token)}
      />
    </VStack>
  );
}
