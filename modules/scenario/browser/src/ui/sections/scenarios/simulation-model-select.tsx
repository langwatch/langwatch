import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Text, VStack } from "@langwatch/design-system/primitives";
import {
  INHERIT_SENTINEL,
  ProviderModelSelector,
} from "@langwatch/design-system/provider-model-selector";
import {
  buildCustomModelDisplayNames,
  LATEST_ALIAS_PROVIDERS,
  modelDisplayLabel,
  modelPickerOption,
  modelSelectorOptions,
} from "@langwatch/model-provider-contract";
import { useMemo } from "react";

import {
  useProjectModelProviders,
  useResolvedDefaultModel,
} from "../../../behavior/scenarios/use-scenario-models.ts";

/**
 * Model picker for the scenario user-simulator and judge roles.
 */
export function SimulationModelSelect({
  label,
  value,
  onChange,
  featureKey,
  size = "full",
}: {
  /** Left out where the caller writes its own label above the picker. */
  label?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  featureKey: "scenarios.user_simulator" | "scenarios.judge";
  size?: "sm" | "md" | "full";
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const projectProviders = useProjectModelProviders({ projectId });

  const resolvedDefault = useResolvedDefaultModel({ projectId, featureKey });

  // Chat models the project can actually use: aliases + registry + custom
  // entries from enabled providers. Same source the default-models drawer
  // narrows from, so the two pickers never disagree about what's available.
  const options = useMemo(() => {
    const providers = projectProviders.data ?? [];
    const enabled = providers.filter((p) => p.enabled === true);
    const enabledKeys = new Set(enabled.map((p) => p.provider));

    const aliases: string[] = [];
    for (const provider of LATEST_ALIAS_PROVIDERS) {
      if (!enabledKeys.has(provider)) continue;
      aliases.push(`${provider}/latest`, `${provider}/latest-mini`);
    }

    const registry = modelSelectorOptions
      .filter((o) => o.mode === "chat" && enabledKeys.has(o.value.split("/")[0] ?? ""))
      .map((o) => o.value);

    const custom: string[] = [];
    for (const p of enabled) {
      for (const m of p.customModels ?? []) {
        if (m?.modelId) custom.push(`${p.provider}/${m.modelId}`);
      }
    }

    return Array.from(new Set([...aliases, ...custom, ...registry]));
  }, [projectProviders.data]);

  // Configured custom-model display names, keyed by `<provider>/<modelId>`.
  const displayNames = useMemo(
    () => buildCustomModelDisplayNames(projectProviders.data ?? []),
    [projectProviders.data],
  );

  const query = useMemo(
    () => ({
      data: options.map((modelValue) => modelPickerOption({ displayNames, modelValue })),
      isLoading: projectProviders.isLoading,
    }),
    [options, displayNames, projectProviders.isLoading],
  );

  const inheritModel = resolvedDefault.data?.model ?? "";

  return (
    <VStack align="stretch" gap={1} width="full">
      {label && (
        <Text fontSize="sm" fontWeight="medium">
          {label}
        </Text>
      )}
      <ProviderModelSelector
        model={value ?? ""}
        query={query}
        labelFor={(fullModelId) => modelDisplayLabel({ fullModelId, displayNames })}
        size={size}
        onChange={(model) => onChange(model === INHERIT_SENTINEL ? null : model)}
        inheritOption={inheritModel ? { model: inheritModel, label: "Default model" } : undefined}
      />
    </VStack>
  );
}
