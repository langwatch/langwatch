import {
  Badge,
  Box,
  createListCollection,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Building2, Folder, Users } from "lucide-react";
import { useMemo } from "react";
import type {
  ModelProviderScopeType,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { Select } from "../ui/select";
import { SmallLabel } from "../SmallLabel";

const SCOPE_DESCRIPTION: Record<ModelProviderScopeType, string> = {
  PROJECT: "Only this project can use this provider.",
  TEAM: "Every project in the team inherits this provider.",
  ORGANIZATION: "Every project in the organization inherits this provider.",
};

const ScopeIcon = ({ scopeType }: { scopeType: ModelProviderScopeType }) => {
  if (scopeType === "ORGANIZATION")
    return <Building2 size={16} aria-hidden />;
  if (scopeType === "TEAM") return <Users size={16} aria-hidden />;
  return <Folder size={16} aria-hidden />;
};

/**
 * Scope picker for model providers.
 *
 * For NEW providers, renders a Chakra Select with three icon-grouped options
 * (Organization / Teams / Projects). Each option encodes scopeType:scopeId,
 * though the current build only exposes one scope per hierarchy tier — the
 * multi-select surface and ModelProviderScope join table land with the
 * schema migration (iter 109 task #60).
 *
 * For EXISTING providers the section stays read-only: scope changes on a
 * persisted credential happen by delete+recreate so we never silently
 * re-parent a credential across orgs/teams.
 *
 * For personal-account projects (no org/team context) the section renders
 * nothing — a scope picker with a single disabled option is just noise.
 */
export function ProviderScopeSection({
  state,
  actions,
  provider,
  teamId,
  teamName,
  organizationId,
  organizationName,
  projectId,
  projectName,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  teamId: string | undefined;
  teamName?: string;
  organizationId: string | undefined;
  organizationName?: string;
  projectId?: string;
  projectName?: string;
}) {
  const isExisting = Boolean(provider.id);
  const hasOrgOrTeam = Boolean(organizationId ?? teamId);

  if (isExisting) {
    const storedScope =
      (provider.scopeType as ModelProviderScopeType | undefined) ?? "PROJECT";
    if (!hasOrgOrTeam && storedScope === "PROJECT") return null;

    return (
      <VStack align="start" width="full" gap={2}>
        <SmallLabel>Scope</SmallLabel>
        <HStack gap={2}>
          <ScopeReadOnlyBadge scopeType={storedScope} />
          <Text fontSize="xs" color="gray.600">
            {SCOPE_DESCRIPTION[storedScope]}
          </Text>
        </HStack>
        <Text fontSize="xs" color="gray.500">
          Scope is fixed after create. To change it, delete and recreate at
          the new scope.
        </Text>
      </VStack>
    );
  }

  if (!hasOrgOrTeam) return null;

  type ScopeOption = {
    value: string;
    label: string;
    scopeType: ModelProviderScopeType;
    scopeId: string;
  };

  const options = useMemo<ScopeOption[]>(() => {
    const out: ScopeOption[] = [];
    if (organizationId) {
      out.push({
        value: `ORGANIZATION:${organizationId}`,
        label: organizationName ?? "Organization",
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
      });
    }
    if (teamId) {
      out.push({
        value: `TEAM:${teamId}`,
        label: teamName ?? "Team",
        scopeType: "TEAM",
        scopeId: teamId,
      });
    }
    if (projectId) {
      out.push({
        value: `PROJECT:${projectId}`,
        label: projectName ?? "Project",
        scopeType: "PROJECT",
        scopeId: projectId,
      });
    }
    return out;
  }, [organizationId, organizationName, teamId, teamName, projectId, projectName]);

  const collection = useMemo(
    () => createListCollection({ items: options }),
    [options],
  );

  const currentScopeType = state.scopeType;
  const currentValue = useMemo(() => {
    const match = options.find((o) => o.scopeType === currentScopeType);
    return match ? [match.value] : [];
  }, [options, currentScopeType]);

  return (
    <VStack align="start" width="full" gap={2}>
      <SmallLabel>Scope</SmallLabel>
      <Select.Root
        collection={collection}
        value={currentValue}
        onValueChange={(details) => {
          const selected = details.value[0];
          if (!selected) return;
          const match = options.find((o) => o.value === selected);
          if (match) actions.setScopeType(match.scopeType);
        }}
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Select scope">
            {(items) => {
              const item = items[0] as ScopeOption | undefined;
              if (!item) return "Select scope";
              return (
                <HStack gap={2}>
                  <ScopeIcon scopeType={item.scopeType} />
                  <Text>{item.label}</Text>
                  <ScopeReadOnlyBadge scopeType={item.scopeType} />
                </HStack>
              );
            }}
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content>
          {options.some((o) => o.scopeType === "ORGANIZATION") && (
            <Select.ItemGroup label="Organization">
              {options
                .filter((o) => o.scopeType === "ORGANIZATION")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="ORGANIZATION" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
          {options.some((o) => o.scopeType === "TEAM") && (
            <Select.ItemGroup label="Teams">
              {options
                .filter((o) => o.scopeType === "TEAM")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="TEAM" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
          {options.some((o) => o.scopeType === "PROJECT") && (
            <Select.ItemGroup label="Projects">
              {options
                .filter((o) => o.scopeType === "PROJECT")
                .map((option) => (
                  <Select.Item key={option.value} item={option}>
                    <HStack gap={2}>
                      <ScopeIcon scopeType="PROJECT" />
                      <Text>{option.label}</Text>
                    </HStack>
                  </Select.Item>
                ))}
            </Select.ItemGroup>
          )}
        </Select.Content>
      </Select.Root>
      <Box>
        <Text fontSize="xs" color="gray.600">
          {SCOPE_DESCRIPTION[currentScopeType]}
        </Text>
      </Box>
    </VStack>
  );
}

function ScopeReadOnlyBadge({
  scopeType,
}: {
  scopeType: ModelProviderScopeType;
}) {
  if (scopeType === "ORGANIZATION") {
    return (
      <Badge colorPalette="blue" variant="subtle" size="sm">
        Organization
      </Badge>
    );
  }
  if (scopeType === "TEAM") {
    return (
      <Badge colorPalette="purple" variant="subtle" size="sm">
        Team
      </Badge>
    );
  }
  return (
    <Badge colorPalette="gray" variant="subtle" size="sm">
      Project
    </Badge>
  );
}
