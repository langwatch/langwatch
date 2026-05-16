/**
 * Default Models settings — shim consuming the new ModelDefaultConfig
 * payload. The full UI rebuild (proper table view + scope filter +
 * drawer with all-roles-at-once form + ModelSelector rendering) lives
 * on the UI lane after this server-side rewrite lands.
 *
 * See specs/model-providers/model-default-config-cascade.feature for
 * the data model and specs/model-providers/role-based-default-models.feature
 * for the UI contract.
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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type ModelRoleKey = "DEFAULT" | "FAST" | "EMBEDDINGS";

const ROLE_LABEL: Record<ModelRoleKey, string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
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
      <HStack gap={3} align="baseline">
        <Heading as="h3" size="md">
          Default Models
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          New UI in progress — table + scope filter + per-role drawer
          land on top of this shim.
        </Text>
      </HStack>

      {/* Top: three effective lines for this project. */}
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
                          {eff.source === "constant"
                            ? "built-in fallback"
                            : `from ${eff.scope}`}
                        </Text>
                      </HStack>
                    ) : (
                      <Badge colorPalette="orange">not configured</Badge>
                    )}
                  </Box>
                </HStack>
              );
            })}
          </VStack>
        </Card.Body>
      </Card.Root>

      {/* Flat list of configs visible from this project's vantage. */}
      <Card.Root width="full" data-testid="configs-card">
        <Card.Body>
          <VStack align="stretch" gap={3}>
            <Heading as="h4" size="sm">
              Configs
            </Heading>
            {data.configs.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">
                No configs yet. Add one to set Default / Fast / Embeddings
                or override a specific feature.
              </Text>
            ) : (
              data.configs.map((c) => (
                <HStack
                  key={c.id}
                  gap={3}
                  align="start"
                  data-testid={`config-row-${c.id}`}
                >
                  <Box width="220px" flexShrink={0}>
                    <HStack gap={2} flexWrap="wrap">
                      {c.scopes.map((s) => (
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
                  <Box flex={1}>
                    <VStack align="start" gap={1}>
                      {Object.entries(c.config).map(([key, model]) => (
                        <HStack key={key} gap={2}>
                          <Text fontSize="xs" color="fg.muted">
                            {key}
                          </Text>
                          <Badge colorPalette="blue">{model as string}</Badge>
                        </HStack>
                      ))}
                    </VStack>
                  </Box>
                </HStack>
              ))
            )}
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}
