/**
 * Page-level "Default Models" section rendered below the providers list on
 * the model-providers settings page. Replaces the in-drawer Default Provider
 * Section (kept around in `ModelProviderDefaultSection.tsx` for reference;
 * no longer rendered).
 *
 * Resolves the effective default models for the current project from
 * project → team → organization → built-in constant, and lets the user set
 * defaults at any scope they have permission on. See
 * specs/model-providers/hierarchical-default-models.feature.
 */

import {
  Badge,
  Box,
  Card,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { allModelOptions } from "~/components/ModelSelector";
import { api } from "~/utils/api";
import { toaster } from "~/components/ui/toaster";
import { ProviderModelSelector } from "./ProviderModelSelector";

type ScopeKey = "organization" | "team" | "project";

const SCOPE_LABEL: Record<ScopeKey, string> = {
  organization: "Organization",
  team: "Team",
  project: "Project",
};

export function DefaultModelsSection() {
  const { project, organization, team, hasPermission } =
    useOrganizationTeamProject();
  const utils = api.useContext();
  const projectId = project?.id ?? "";

  const effectiveQuery = api.modelProvider.getEffectiveDefaultModels.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const setOrgMutation =
    api.modelProvider.setOrganizationDefaultModels.useMutation();
  const setTeamMutation =
    api.modelProvider.setTeamDefaultModels.useMutation();
  const setProjectMutation =
    api.modelProvider.setProjectDefaultModels.useMutation();

  const modelChoices = useMemo(() => allModelOptions, []);

  if (effectiveQuery.isLoading || !effectiveQuery.data) {
    return (
      <Card.Root width="full">
        <Card.Body>
          <HStack gap={3}>
            <Spinner size="sm" />
            <Text>Loading default models…</Text>
          </HStack>
        </Card.Body>
      </Card.Root>
    );
  }

  const data = effectiveQuery.data;

  const canManage = (scope: ScopeKey): boolean => {
    if (scope === "organization") {
      return hasPermission("organization:manage");
    }
    if (scope === "team") {
      return hasPermission("team:manage");
    }
    return hasPermission("project:update");
  };

  const invalidate = () =>
    utils.modelProvider.getEffectiveDefaultModels.invalidate({ projectId });

  const writeScope = async (
    scope: ScopeKey,
    field: "defaultModel" | "topicClusteringModel" | "embeddingsModel",
    value: string,
  ) => {
    try {
      if (scope === "organization") {
        if (!organization?.id) return;
        await setOrgMutation.mutateAsync({
          organizationId: organization.id,
          [field]: value || null,
        });
      } else if (scope === "team") {
        if (!team?.id) return;
        await setTeamMutation.mutateAsync({
          teamId: team.id,
          [field]: value || null,
        });
      } else {
        if (!projectId) return;
        await setProjectMutation.mutateAsync({
          projectId,
          [field]: value || null,
        });
      }
      await invalidate();
      toaster.create({
        title: `${SCOPE_LABEL[scope]} default updated`,
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
    } catch (err) {
      toaster.create({
        title: "Failed to update default model",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    }
  };

  const scopeValues: Record<ScopeKey, typeof data.project> = {
    organization: data.organization,
    team: data.team,
    project: data.project,
  };

  const effective = data.effective;

  return (
    <VStack gap={4} width="full" align="stretch">
      <HStack gap={3} align="baseline">
        <Heading as="h3" size="md">
          Default Models
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Picked when a feature doesn't ask for a specific model. Resolves
          project → team → organization, with a built-in fallback.
        </Text>
      </HStack>

      <Card.Root width="full">
        <Card.Body>
          <VStack gap={3} align="stretch">
            <HStack gap={2} align="baseline">
              <Text fontWeight="medium">Effective default</Text>
              <Badge colorPalette="blue">{effective.defaultModel.value}</Badge>
              <Text fontSize="sm" color="fg.muted">
                {effective.defaultModel.source === "constant"
                  ? "(built-in fallback)"
                  : `(inherited from ${effective.defaultModel.source})`}
              </Text>
            </HStack>
            <HStack gap={2} align="baseline" flexWrap="wrap">
              <Text fontSize="sm" color="fg.muted">
                Topic clustering:
              </Text>
              <Badge colorPalette="gray" variant="subtle">
                {effective.topicClusteringModel.value}
              </Badge>
              <Text fontSize="sm" color="fg.muted">
                {effective.topicClusteringModel.source === "constant"
                  ? "fallback"
                  : effective.topicClusteringModel.source}
              </Text>
              <Box width={4} />
              <Text fontSize="sm" color="fg.muted">
                Embeddings:
              </Text>
              <Badge colorPalette="gray" variant="subtle">
                {effective.embeddingsModel.value}
              </Badge>
              <Text fontSize="sm" color="fg.muted">
                {effective.embeddingsModel.source === "constant"
                  ? "fallback"
                  : effective.embeddingsModel.source}
              </Text>
            </HStack>
          </VStack>
        </Card.Body>
      </Card.Root>

      {(["organization", "team", "project"] as const).map((scope) => {
        const writable = canManage(scope);
        const value = scopeValues[scope];
        const helper =
          scope === "organization"
            ? `Applied to every project in ${organization?.name ?? "this organization"} unless a team or project overrides.`
            : scope === "team"
              ? `Overrides the organization default for projects in ${team?.name ?? "this team"}.`
              : `Overrides team / organization defaults for ${project?.name ?? "this project"} only.`;
        return (
          <Card.Root key={scope} width="full">
            <Card.Body>
              <VStack gap={3} align="stretch">
                <HStack gap={2} align="baseline">
                  <Heading as="h4" size="sm">
                    {SCOPE_LABEL[scope]}
                  </Heading>
                  {!writable && (
                    <Tooltip content={`Requires ${scope}:manage permission`}>
                      <Badge colorPalette="gray" variant="subtle">
                        read-only
                      </Badge>
                    </Tooltip>
                  )}
                </HStack>
                <Text fontSize="sm" color="fg.muted">
                  {helper}
                </Text>
                <ScopeRow
                  label="Default model"
                  current={value?.defaultModel ?? ""}
                  inheritedHint={
                    !value?.defaultModel && scope === "project"
                      ? `Inherited from ${effective.defaultModel.source}`
                      : undefined
                  }
                  options={modelChoices}
                  disabled={!writable}
                  onChange={(v) => writeScope(scope, "defaultModel", v)}
                />
                <ScopeRow
                  label="Topic clustering"
                  current={value?.topicClusteringModel ?? ""}
                  options={modelChoices}
                  disabled={!writable}
                  onChange={(v) =>
                    writeScope(scope, "topicClusteringModel", v)
                  }
                />
                <ScopeRow
                  label="Embeddings"
                  current={value?.embeddingsModel ?? ""}
                  options={modelChoices}
                  disabled={!writable}
                  onChange={(v) => writeScope(scope, "embeddingsModel", v)}
                />
              </VStack>
            </Card.Body>
          </Card.Root>
        );
      })}
    </VStack>
  );
}

function ScopeRow({
  label,
  current,
  inheritedHint,
  options,
  onChange,
  disabled,
}: {
  label: string;
  current: string;
  inheritedHint?: string;
  options: string[];
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  return (
    <HStack gap={3} width="full" align="center">
      <Box width="160px" flexShrink={0}>
        <Text fontSize="sm">{label}</Text>
      </Box>
      <Box flex={1}>
        <ProviderModelSelector
          model={current}
          options={options}
          onChange={onChange}
          disabled={disabled}
        />
      </Box>
      {inheritedHint && (
        <Text fontSize="xs" color="fg.muted">
          {inheritedHint}
        </Text>
      )}
    </HStack>
  );
}
