import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import {
  INHERIT_SENTINEL,
  ProviderModelSelector,
} from "@langwatch/design-system/provider-model-selector";
import { modelDisplayLabel, modelPickerOption } from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import { useProjectModelProviders } from "../../../behavior/scenarios/use-scenario-models.ts";
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

  const projectProviders = useProjectModelProviders({ projectId });

  const { options, displayNames } = useMemo(
    () => callerVoiceOptions({ providers: projectProviders.data ?? [] }),
    [projectProviders.data],
  );
  const query = useMemo(
    () => ({
      data: options.map((modelValue) => modelPickerOption({ displayNames, modelValue })),
      isLoading: projectProviders.isLoading,
    }),
    [options, displayNames, projectProviders.isLoading],
  );

  return (
    <ProviderModelSelector
      model={value ?? ""}
      query={query}
      labelFor={(fullModelId) => modelDisplayLabel({ fullModelId, displayNames })}
      size={size}
      onChange={(model) => onChange(model === INHERIT_SENTINEL ? null : model)}
      inheritOption={{ label: "Project default" }}
    />
  );
}
