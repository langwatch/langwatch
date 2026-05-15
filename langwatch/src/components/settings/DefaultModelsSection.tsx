/**
 * Default Models settings — current effective lines + flat overrides
 * list, mirroring the RBAC settings page.
 *
 * The page renders three "current default" lines at the top (one per
 * role, with the inheritance hint) and a flat list of assignment rows
 * below — each row groups every ModelDefault scope that shares the
 * same (role, featureKey, model) so a single "rule" can apply to
 * multiple teams or projects with one chip-picker. "+ Add override"
 * opens a drawer to author a new assignment.
 *
 * See specs/model-providers/role-based-default-models.feature for the
 * full behavioural contract. Drawer + ScopeChipPicker integration is
 * landed by the UI lane on top of this shim.
 */

import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useMemo } from "react";

import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

type DefaultModelsPayload =
  RouterOutputs["modelProvider"]["getDefaultModelsForProject"];
type ModelRoleKey = "DEFAULT" | "FAST" | "EMBEDDINGS";

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

const SCOPE_CHIP_LABEL: Record<"ORGANIZATION" | "TEAM" | "PROJECT", string> = {
  ORGANIZATION: "Organization",
  TEAM: "Team",
  PROJECT: "Project",
};

export function DefaultModelsSection() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const dataQuery = api.modelProvider.getDefaultModelsForProject.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const featureByKey = useMemo(() => {
    const map = new Map<string, DefaultModelsPayload["features"][number]>();
    for (const f of dataQuery.data?.features ?? []) map.set(f.key, f);
    return map;
  }, [dataQuery.data?.features]);

  if (dataQuery.isLoading || !dataQuery.data) {
    return (
      <Card.Root width="full" data-testid="default-models-section">
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
  const roles: ModelRoleKey[] = ["DEFAULT", "FAST", "EMBEDDINGS"];

  return (
    <VStack
      gap={4}
      width="full"
      align="stretch"
      data-testid="default-models-section"
    >
      <HStack gap={3} align="baseline" justify="space-between">
        <VStack align="start" gap={1}>
          <Heading as="h3" size="md">
            Default Models
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            One pick per role flows everywhere. Override per scope or per
            feature below.
          </Text>
        </VStack>
        <Button
          size="sm"
          variant="outline"
          data-testid="add-override-button"
          // The drawer is wired by the override-editor lane on top of
          // this shim. The button stays visible so the page reads
          // correctly during integration.
        >
          <HStack gap={1}>
            <Plus size={14} />
            <Text>Add override</Text>
          </HStack>
        </Button>
      </HStack>

      {/* Top: three "effective for this project" lines. */}
      <Card.Root width="full" data-testid="effective-models-card">
        <Card.Body>
          <VStack align="stretch" gap={3}>
            {roles.map((role) => {
              const eff = data.effective[role];
              return (
                <HStack
                  key={role}
                  gap={3}
                  align="center"
                  data-testid={`role-line-${role.toLowerCase()}`}
                >
                  <Box width="120px" flexShrink={0}>
                    <Text fontWeight="medium">{ROLE_LABEL[role]}</Text>
                  </Box>
                  <Box flex={1}>
                    {eff ? (
                      <HStack gap={2}>
                        <Badge colorPalette="blue">{eff.model}</Badge>
                        <Text fontSize="xs" color="fg.muted">
                          {sourceHint(eff.source, eff.scope)}
                        </Text>
                      </HStack>
                    ) : (
                      <Badge colorPalette="orange">not configured</Badge>
                    )}
                  </Box>
                  <Tooltip content={ROLE_BLURB[role]}>
                    <Text fontSize="xs" color="fg.muted" maxWidth="320px">
                      {ROLE_BLURB[role]}
                    </Text>
                  </Tooltip>
                </HStack>
              );
            })}
          </VStack>
        </Card.Body>
      </Card.Root>

      {/* Flat overrides list, RBAC-style. */}
      <Card.Root width="full" data-testid="overrides-card">
        <Card.Body>
          <VStack align="stretch" gap={3}>
            <Heading as="h4" size="sm">
              Overrides
            </Heading>
            {data.assignments.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No overrides yet. Add one to point a scope or a feature at
                a different model.
              </Text>
            ) : (
              data.assignments.map((a) => {
                const feature = a.featureKey
                  ? featureByKey.get(a.featureKey)
                  : null;
                return (
                  <HStack
                    key={a.id}
                    gap={3}
                    align="center"
                    data-testid={`assignment-row-${a.id}`}
                  >
                    <Box width="160px" flexShrink={0}>
                      <Text fontSize="sm" fontWeight="medium">
                        {ROLE_LABEL[a.role as ModelRoleKey]}
                        {feature ? ` · ${feature.displayName}` : ""}
                      </Text>
                    </Box>
                    <Box flex={1}>
                      <HStack gap={2} flexWrap="wrap">
                        <Badge colorPalette="blue">{a.model}</Badge>
                        {a.scopes.map((s) => (
                          <Badge
                            key={`${s.type}:${s.id}`}
                            colorPalette="gray"
                            variant="subtle"
                          >
                            {SCOPE_CHIP_LABEL[s.type]} · {s.name}
                          </Badge>
                        ))}
                      </HStack>
                    </Box>
                  </HStack>
                );
              })
            )}
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

function sourceHint(source: string, scope: string | null): string {
  if (source === "constant") return "built-in fallback";
  if (source === "feature_override") return `feature override · ${scope}`;
  return `from ${scope}`;
}
