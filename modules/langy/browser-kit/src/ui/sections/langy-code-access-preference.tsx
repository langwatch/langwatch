/**
 * The remembered answer to "how should Langy reach my code" (ADR-129), letting the reader take
 * it back. Hangs off the Integrations screen's GitHub card.
 */
import { Button, Card, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { GitHub } from "react-feather";

import { langyCodeAccessApi } from "../../behavior/langy-code-access-api.ts";

export function LangyCodeAccessPreference({ standalone = false }: { standalone?: boolean }) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const preference = langyCodeAccessApi.langy.getCodeAccessPreference.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, retry: false },
  );
  const clear = langyCodeAccessApi.langy.setCodeAccessPreference.useMutation({
    onSuccess: () => void preference.refetch(),
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Could not clear the choice" }),
  });

  if (preference.data?.preference !== "github" || !projectId) return null;

  const line = (
    <HStack
      gap={3}
      justifyContent="space-between"
      borderTopWidth={standalone ? "0" : "1px"}
      borderColor="border.muted"
      paddingTop={standalone ? 0 : 3}
    >
      <Text fontSize="sm" color="fg.muted">
        Langy uses GitHub for code changes
      </Text>
      <Button
        size="sm"
        variant="outline"
        loading={clear.isPending}
        onClick={() => clear.mutate({ projectId, preference: null })}
      >
        Change
      </Button>
    </HStack>
  );

  if (!standalone) return line;

  return (
    <Card.Root id="langy-code-access">
      <Card.Body>
        <VStack align="stretch" gap={2}>
          <HStack gap={2}>
            <GitHub size={18} />
            <Heading size="sm">Langy code access</Heading>
          </HStack>
          {line}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
