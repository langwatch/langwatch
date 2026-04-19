import { Badge, Box, HStack, RadioGroup, Text, VStack } from "@chakra-ui/react";
import type {
  ModelProviderScopeType,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";

const SCOPE_DESCRIPTION: Record<ModelProviderScopeType, string> = {
  PROJECT: "Only this project can use this provider.",
  TEAM: "Every project in the team inherits this provider.",
  ORGANIZATION: "Every project in the organization inherits this provider.",
};

/**
 * Renders the principal-style scope picker for a NEW model provider or a
 * read-only indicator for an existing one.
 *
 * Editable radio picker only surfaces for brand-new providers
 * (`provider.id` undefined) so we never silently re-parent credentials
 * across orgs/teams. To change an existing provider's scope, delete it
 * and recreate at the new scope — that path is explicit about the
 * credential lifecycle.
 *
 * For existing providers we still render the current scope as a static
 * badge + helper text, so operators can see at a glance whether they're
 * editing a Project / Team / Organization row (finding #81).
 *
 * ORGANIZATION and TEAM radios only appear in the picker when the
 * respective ID is available from useOrganizationTeamProject; otherwise
 * they're silently hidden (e.g. personal-account projects without a team).
 */
export function ProviderScopeSection({
  state,
  actions,
  provider,
  teamId,
  organizationId,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  teamId: string | undefined;
  organizationId: string | undefined;
}) {
  const isExisting = Boolean(provider.id);
  const hasOrgOrTeam = Boolean(organizationId ?? teamId);

  // Existing provider → static "Current scope" indicator (finding #81).
  // Still return null when there's no org/team context AND the stored row
  // is the default PROJECT scope — that's 100% of legacy data and the
  // section would say nothing useful.
  if (isExisting) {
    const storedScope =
      (provider.scopeType as ModelProviderScopeType | undefined) ?? "PROJECT";
    if (!hasOrgOrTeam && storedScope === "PROJECT") return null;

    return (
      <VStack align="start" width="full" gap={2}>
        <SmallLabel>Availability</SmallLabel>
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

  const description = SCOPE_DESCRIPTION;

  return (
    <VStack align="start" width="full" gap={2}>
      <SmallLabel>Availability</SmallLabel>
      <RadioGroup.Root
        value={state.scopeType}
        onValueChange={(details) => {
          actions.setScopeType(details.value as ModelProviderScopeType);
        }}
      >
        <HStack gap={6} wrap="wrap">
          <RadioGroup.Item value="PROJECT">
            <RadioGroup.ItemHiddenInput />
            <RadioGroup.ItemIndicator />
            <RadioGroup.ItemText>Project</RadioGroup.ItemText>
          </RadioGroup.Item>
          {teamId ? (
            <RadioGroup.Item value="TEAM">
              <RadioGroup.ItemHiddenInput />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>Team</RadioGroup.ItemText>
            </RadioGroup.Item>
          ) : null}
          {organizationId ? (
            <RadioGroup.Item value="ORGANIZATION">
              <RadioGroup.ItemHiddenInput />
              <RadioGroup.ItemIndicator />
              <RadioGroup.ItemText>Organization</RadioGroup.ItemText>
            </RadioGroup.Item>
          ) : null}
        </HStack>
      </RadioGroup.Root>
      <Box>
        <Text fontSize="xs" color="gray.600">
          {description[state.scopeType]}
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
