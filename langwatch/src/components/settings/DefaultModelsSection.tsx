/**
 * Line-based "Default Models" section. Renders the three role lines
 * (Default / Fast / Embeddings) below the providers list on the
 * model-providers settings page. Each line shows the project's effective
 * model + an inheritance chip ("inherited from organization", etc.), and
 * lets admins set the role-level value at any scope they can manage
 * (Organization / Team / Project) plus expand a list of platform features
 * for per-feature overrides.
 *
 * Replaces the B2 Org/Team/Project section-block design. See
 * specs/model-providers/role-based-default-models.feature.
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
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { allModelOptions } from "~/components/ModelSelector";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { toaster } from "~/components/ui/toaster";
import { ProviderModelSelector } from "./ProviderModelSelector";

type ModelRoleKey = "DEFAULT" | "FAST" | "EMBEDDINGS";
type ScopeKey = "organization" | "team" | "project";

const ROLE_LABEL: Record<ModelRoleKey, string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
};

const ROLE_BLURB: Record<ModelRoleKey, string> = {
  DEFAULT:
    "The workhorse. Picked when a prompt or evaluator is created and for high-stakes calls.",
  FAST: "The quick-smarty. Used by AI search, autocomplete, commit-message generation, topic clustering, and scenario generation.",
  EMBEDDINGS: "Semantic vectors used by topic clustering and similar features.",
};

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

  const dataQuery = api.modelProvider.getDefaultModelsForProject.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const setRoleMutation =
    api.modelProvider.setRoleAssignmentForScope.useMutation();
  const setFeatureMutation =
    api.modelProvider.setFeatureOverrideForScope.useMutation();

  const modelChoices = useMemo(() => allModelOptions, []);

  const canManage = (scope: ScopeKey): boolean => {
    if (scope === "organization") return hasPermission("organization:manage");
    if (scope === "team") return hasPermission("team:manage");
    return hasPermission("project:update");
  };

  const scopeId = (scope: ScopeKey): string | null => {
    if (scope === "organization") return organization?.id ?? null;
    if (scope === "team") return team?.id ?? null;
    return project?.id ?? null;
  };

  const invalidate = () =>
    utils.modelProvider.getDefaultModelsForProject.invalidate({ projectId });

  const setRole = async (
    scope: ScopeKey,
    role: ModelRoleKey,
    model: string,
  ) => {
    const id = scopeId(scope);
    if (!id) return;
    try {
      await setRoleMutation.mutateAsync({
        scopeType: scope.toUpperCase() as "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: id,
        role,
        model: model || null,
      });
      await invalidate();
      toaster.create({
        title: `${SCOPE_LABEL[scope]} ${ROLE_LABEL[role]} model updated`,
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
    } catch (err) {
      toaster.create({
        title: "Failed to update model",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    }
  };

  const setFeature = async (
    scope: ScopeKey,
    featureKey: string,
    model: string,
  ) => {
    const id = scopeId(scope);
    if (!id) return;
    try {
      await setFeatureMutation.mutateAsync({
        scopeType: scope.toUpperCase() as "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: id,
        featureKey,
        model: model || null,
      });
      await invalidate();
      toaster.create({
        title: `Feature override updated`,
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
    } catch (err) {
      toaster.create({
        title: "Failed to update feature override",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
    }
  };

  if (dataQuery.isLoading || !dataQuery.data) {
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

  const data = dataQuery.data;

  return (
    <VStack
      gap={4}
      width="full"
      align="stretch"
      data-testid="default-models-section"
    >
      <HStack gap={3} align="baseline">
        <Heading as="h3" size="md">
          Default Models
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Picked by features that don't ask for a specific model. Resolves
          project → team → organization, with a built-in fallback.
        </Text>
      </HStack>

      {data.roles.map((roleData) => (
        <RoleLine
          key={roleData.role}
          role={roleData.role as ModelRoleKey}
          effective={roleData.effective}
          perScope={roleData.perScope}
          features={roleData.features}
          organizationName={organization?.name}
          teamName={team?.name}
          projectName={project?.name}
          canManage={canManage}
          scopeId={scopeId}
          options={modelChoices}
          onSetRole={setRole}
          onSetFeature={setFeature}
        />
      ))}
    </VStack>
  );
}

type DefaultModelsPayload =
  RouterOutputs["modelProvider"]["getDefaultModelsForProject"];
type RoleData = DefaultModelsPayload["roles"][number];

function RoleLine({
  role,
  effective,
  perScope,
  features,
  organizationName,
  teamName,
  projectName,
  canManage,
  scopeId,
  options,
  onSetRole,
  onSetFeature,
}: {
  role: ModelRoleKey;
  effective: RoleData["effective"];
  perScope: RoleData["perScope"];
  features: RoleData["features"];
  organizationName?: string;
  teamName?: string;
  projectName?: string;
  canManage: (scope: ScopeKey) => boolean;
  scopeId: (scope: ScopeKey) => string | null;
  options: string[];
  onSetRole: (scope: ScopeKey, role: ModelRoleKey, model: string) => void;
  onSetFeature: (scope: ScopeKey, featureKey: string, model: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = role !== "EMBEDDINGS" && features.length > 0;
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <Card.Root width="full" data-testid={`role-line-${role.toLowerCase()}`}>
      <Card.Body>
        <VStack align="stretch" gap={3}>
          <HStack gap={3} align="center">
            {canExpand && (
              <Box
                as="button"
                onClick={() => setExpanded((prev) => !prev)}
                cursor="pointer"
                data-testid={`role-line-${role.toLowerCase()}-expand`}
              >
                <ChevronIcon size={18} />
              </Box>
            )}
            {!canExpand && <Box width="18px" />}
            <Heading as="h4" size="sm">
              {ROLE_LABEL[role]}
            </Heading>
            {effective ? (
              <>
                <Badge colorPalette="blue">{effective.model}</Badge>
                <SourceChip
                  source={effective.source}
                  scope={effective.scope}
                  organizationName={organizationName}
                  teamName={teamName}
                  projectName={projectName}
                />
              </>
            ) : (
              <Badge colorPalette="orange">not configured</Badge>
            )}
            <Box flex={1} />
            <Text fontSize="xs" color="fg.muted">
              {ROLE_BLURB[role]}
            </Text>
          </HStack>

          {/* Per-scope role-level value rows. The user sets the role's
              model at the scope they manage; clearing falls back to the
              next scope up. */}
          <VStack align="stretch" gap={2} paddingLeft={6}>
            {(["organization", "team", "project"] as const).map((scope) => {
              const writable = canManage(scope) && !!scopeId(scope);
              const current = perScope[scope] ?? "";
              return (
                <HStack key={scope} gap={3} align="center">
                  <Box width="120px" flexShrink={0}>
                    <Text fontSize="sm" color="fg.muted">
                      {SCOPE_LABEL[scope]}
                    </Text>
                  </Box>
                  <Box flex={1}>
                    <ProviderModelSelector
                      model={current}
                      options={options}
                      onChange={(m) => onSetRole(scope, role, m)}
                      disabled={!writable}
                    />
                  </Box>
                  {!writable && scopeId(scope) && (
                    <Tooltip
                      content={
                        scope === "project"
                          ? "Requires project:update permission"
                          : `Requires ${scope}:manage permission`
                      }
                    >
                      <Badge colorPalette="gray" variant="subtle">
                        read-only
                      </Badge>
                    </Tooltip>
                  )}
                </HStack>
              );
            })}
          </VStack>

          {canExpand && expanded && (
            <VStack
              align="stretch"
              gap={2}
              paddingLeft={6}
              data-testid={`role-line-${role.toLowerCase()}-features`}
            >
              <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                Features using this role
              </Text>
              {features.map((f) => (
                <FeatureRow
                  key={f.key}
                  feature={f}
                  role={role}
                  canManage={canManage}
                  scopeId={scopeId}
                  options={options}
                  onSetFeature={onSetFeature}
                />
              ))}
            </VStack>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function SourceChip({
  source,
  scope,
  organizationName,
  teamName,
  projectName,
}: {
  source: string;
  scope: string | null;
  organizationName?: string;
  teamName?: string;
  projectName?: string;
}) {
  if (source === "constant") {
    return (
      <Text fontSize="xs" color="fg.muted">
        built-in fallback
      </Text>
    );
  }
  if (source === "feature_override") {
    return (
      <Text fontSize="xs" color="fg.muted">
        feature override · {scope}
      </Text>
    );
  }
  // role_default
  const named =
    scope === "organization"
      ? organizationName
      : scope === "team"
        ? teamName
        : scope === "project"
          ? projectName
          : null;
  return (
    <Text fontSize="xs" color="fg.muted">
      inherited from {scope}
      {named ? ` ${named}` : ""}
    </Text>
  );
}

function FeatureRow({
  feature,
  role,
  canManage,
  scopeId,
  options,
  onSetFeature,
}: {
  feature: RoleData["features"][number];
  role: ModelRoleKey;
  canManage: (scope: ScopeKey) => boolean;
  scopeId: (scope: ScopeKey) => string | null;
  options: string[];
  onSetFeature: (scope: ScopeKey, featureKey: string, model: string) => void;
}) {
  // Per-feature override is currently editable at project scope only.
  // Org/team override surfaces stay viewable below as @unimplemented in
  // the spec until B3.2c lands the scope-line UI.
  const writable = canManage("project") && !!scopeId("project");
  const current = feature.perScope.project ?? "";
  const hasAnyOverride =
    feature.perScope.project !== null ||
    feature.perScope.team !== null ||
    feature.perScope.organization !== null;
  const effectiveLabel = feature.effective
    ? feature.effective.source === "feature_override"
      ? `feature override (${feature.effective.scope}) · ${feature.effective.model}`
      : `inherits ${ROLE_LABEL[role]} (${feature.effective.model})`
    : "not configured";
  return (
    <HStack
      gap={3}
      align="center"
      data-testid={`feature-row-${feature.key}`}
    >
      <Box width="160px" flexShrink={0}>
        <Text fontSize="sm">{feature.displayName}</Text>
        <Text fontSize="xs" color="fg.muted">
          {feature.description}
        </Text>
      </Box>
      <Box flex={1}>
        <ProviderModelSelector
          model={current}
          options={options}
          onChange={(m) => onSetFeature("project", feature.key, m)}
          disabled={!writable}
        />
      </Box>
      <Text fontSize="xs" color={hasAnyOverride ? "fg" : "fg.muted"}>
        {effectiveLabel}
      </Text>
    </HStack>
  );
}
