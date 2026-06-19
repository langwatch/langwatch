import { Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { modelSelectorOptions } from "../ModelSelector";
import {
  INHERIT_SENTINEL,
  ProviderModelSelector,
} from "../settings/ProviderModelSelector";
import { LATEST_ALIAS_PROVIDERS } from "../../server/modelProviders/latestAliases";

/**
 * Model picker for the scenario user-simulator and judge roles.
 *
 * Mirrors the Edit-default-models drawer UX: a "Default model" entry sits at
 * the top (the project's resolved scenarios.user_simulator / scenarios.judge
 * model) and is selected whenever the field is left unset (null). Picking it
 * clears the override so the run follows the project default; picking a
 * concrete model pins it for this scenario / run plan.
 *
 * `value === null` means "follow the default"; a string is an explicit pin.
 */
export function SimulationModelSelect({
  label,
  value,
  onChange,
  featureKey,
  size = "full",
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  featureKey: "scenarios.user_simulator" | "scenarios.judge";
  size?: "sm" | "md" | "full";
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const projectProviders =
    api.modelProvider.listAllForProjectForFrontend.useQuery(
      { projectId },
      { enabled: !!projectId, refetchOnMount: false },
    );

  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId, featureKey },
    { enabled: !!projectId },
  );

  // Chat models the project can actually use: aliases + registry + custom
  // entries from enabled providers. Same source the default-models drawer
  // narrows from, so the two pickers never disagree about what's available.
  const options = useMemo(() => {
    const providers = projectProviders.data?.providers ?? [];
    const enabled = providers.filter((p) => p.enabled === true);
    const enabledKeys = new Set(enabled.map((p) => p.provider));

    const aliases: string[] = [];
    for (const provider of LATEST_ALIAS_PROVIDERS) {
      if (!enabledKeys.has(provider)) continue;
      aliases.push(`${provider}/latest`, `${provider}/latest-mini`);
    }

    const registry = modelSelectorOptions
      .filter(
        (o) =>
          o.mode === "chat" &&
          enabledKeys.has(o.value.split("/")[0] ?? ""),
      )
      .map((o) => o.value);

    const custom: string[] = [];
    for (const p of enabled) {
      for (const m of p.customModels ?? []) {
        if (m?.modelId) custom.push(`${p.provider}/${m.modelId}`);
      }
    }

    return Array.from(new Set([...aliases, ...custom, ...registry]));
  }, [projectProviders.data]);

  const inheritModel = resolvedDefault.data?.model ?? "";

  return (
    <VStack align="stretch" gap={1} width="full">
      <Text fontSize="sm" fontWeight="medium">
        {label}
      </Text>
      <ProviderModelSelector
        model={value ?? ""}
        options={options}
        size={size}
        onChange={(model) =>
          onChange(model === INHERIT_SENTINEL ? null : model)
        }
        inheritOption={
          inheritModel
            ? { model: inheritModel, label: "Default model" }
            : undefined
        }
      />
    </VStack>
  );
}
