import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  INHERIT_SENTINEL,
  ProviderModelSelector,
} from "@langwatch/model-provider-web/surfaces/provider-model-selector";
import { callerVoiceOptions } from "./caller-voice-model-options";

/**
 * The caller Voice picker: the caller voices the project has credentials for,
 * with a "Project default" entry at the top for the unset (null) state.
 *
 * A separate component from the chat/embedding `SimulationModelSelect` on
 * purpose — it lists caller voices, and keeping it apart means the chat and
 * embedding pickers keep their exact behaviour (AC18).
 *
 * `value === null` follows the project default voice; a string pins one.
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

  const projectProviders =
    api.modelProvider.listAllForProjectForFrontend.useQuery(
      { projectId },
      { enabled: !!projectId, refetchOnMount: false },
    );

  const { options, displayNames } = useMemo(
    () =>
      callerVoiceOptions({ providers: projectProviders.data?.providers ?? [] }),
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
