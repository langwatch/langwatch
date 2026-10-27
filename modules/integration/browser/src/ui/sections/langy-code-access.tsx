/**
 * Reads the remembered code-access choice (ADR-129) and renders langy's block for it, which
 * clears it. Shows nothing until a choice is stored.
 */
import { showErrorToast } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";

import { langyApi } from "../../behavior/langy-api.ts";
import { LangyCodeAccessPreference } from "./langy/langy-code-access-preference.tsx";

export function LangyCodeAccess({ standalone = false }: { standalone?: boolean }) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const preference = langyApi.langy.getCodeAccessPreference.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, retry: false },
  );
  const clear = langyApi.langy.setCodeAccessPreference.useMutation({
    onSuccess: () => void preference.refetch(),
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Could not clear the choice" }),
  });

  if (preference.data?.preference !== "github" || !projectId) return null;

  return (
    <LangyCodeAccessPreference
      standalone={standalone}
      isClearing={clear.isPending}
      onClear={() => clear.mutate({ projectId, preference: null })}
    />
  );
}
