import { Box, HStack, RadioGroup, Text, VStack } from "@chakra-ui/react";
import type {
  ModelProviderScopeType,
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";

/**
 * Renders the principal-style scope picker for a model provider.
 *
 * Only surfaces for brand-new providers (`provider.id` undefined). Existing
 * providers keep their stored scope — editing scope requires a delete +
 * recreate, which lives in a separate code path so we never quietly
 * re-parent credentials from one team/org to another.
 *
 * ORGANIZATION and TEAM options only appear when the respective ID is
 * available from useOrganizationTeamProject; otherwise the picker silently
 * falls back to PROJECT-only (e.g. personal-account projects without a team).
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
  if (isExisting || !hasOrgOrTeam) return null;

  const description: Record<ModelProviderScopeType, string> = {
    PROJECT: "Only this project can use this provider.",
    TEAM: "Every project in the team inherits this provider.",
    ORGANIZATION:
      "Every project in the organization inherits this provider.",
  };

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
