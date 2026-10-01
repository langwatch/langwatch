import { INHERIT_SENTINEL, ProviderModelSelector } from "@langwatch/model-provider-browser-kit";
import { useMemo } from "react";

import { api } from "../../../behavior/scenario-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { callerVoiceOptions } from "./caller-voice-model-options";

/**
 * The caller Voice picker: caller voices the project has credentials for,
 * with a "Project default" entry for the unset (null) state. Kept separate
 * from `SimulationModelSelect` so the chat/embedding pickers keep their exact behaviour (AC18).
 */
export function CallerVoiceModelSelect({
  value,
  onChange,
  size = "full",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  size?: "sm" | "md" | "full";
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const projectProviders = api.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnMount: false },
  );

  const { options, displayNames } = useMemo(
    () => callerVoiceOptions({ providers: projectProviders.data ?? [] }),
    [projectProviders.data],
  );

  return (
    <ProviderModelSelector
      model={value ?? ""}
      options={options}
      displayNames={displayNames}
      size={size}
      onChange={(model) => onChange(model === INHERIT_SENTINEL ? null : model)}
      inheritOption={{ label: "Project default" }}
    />
  );
}
