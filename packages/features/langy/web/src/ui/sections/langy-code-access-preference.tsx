/**
 * The remembered answer to "how should Langy reach my code" (ADR-129).
 *
 * The choice is made in the chat, so this line only appears once one is stored, and its one job
 * is to let the reader take it back. It hangs off the Integrations screen's GitHub card, which
 * is where a person goes looking for what Langy may reach.
 */
import { Button, HStack, Text } from "@chakra-ui/react";
import { showErrorToast } from "@langwatch/ui-host/errors";

import { api } from "../../behavior/langy-api";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";

export function LangyCodeAccessPreference() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const preference = api.langy.getCodeAccessPreference.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, retry: false },
  );
  const clear = api.langy.setCodeAccessPreference.useMutation({
    onSuccess: () => void preference.refetch(),
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Could not clear the choice" }),
  });

  if (preference.data?.preference !== "github" || !projectId) return null;

  return (
    <HStack
      gap={3}
      justifyContent="space-between"
      borderTopWidth="1px"
      borderColor="border.muted"
      paddingTop={3}
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
}
