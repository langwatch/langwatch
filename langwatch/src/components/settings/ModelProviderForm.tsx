import { Box, Button, Field, HStack, Input, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useDrawer } from "../../hooks/useDrawer";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { useModelProviderApiKeyValidation } from "../../hooks/useModelProviderApiKeyValidation";
import { useModelProviderForm } from "../../hooks/useModelProviderForm";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import {
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../../server/modelProviders/registry";
import {
  hasUserEnteredNewApiKey,
  hasUserModifiedNonApiKeyFields,
} from "../../utils/modelProviderHelpers";
import { parseZodFieldErrors, type ZodErrorStructure } from "../../utils/zod";
import { SmallLabel } from "../SmallLabel";
import { Switch } from "../ui/switch";
import {
  draftFromProvider,
  EMPTY_ADVANCED_DRAFT,
  type ModelProviderAdvancedDraft,
  ModelProviderAdvancedSection,
  parseAdvancedDraft,
} from "./ModelProviderAdvancedSection";
import { CredentialsSection } from "./ModelProviderCredentialsSection";
import { CustomModelInputSection } from "./ModelProviderCustomModelInput";
// DefaultProviderSection has been moved out of this drawer to a page-level
// section on the model-providers settings page (DefaultModelsSection). See
// specs/model-providers/hierarchical-default-models.feature.
import { ExtraHeadersSection } from "./ModelProviderExtraHeadersSection";
import { ProviderScopeSection } from "./ModelProviderScopeSection";

export type EditModelProviderFormProps = {
  projectId?: string | undefined;
  organizationId?: string | undefined;
  modelProviderId?: string;
  providerKey: string;
};

export const EditModelProviderForm = ({
  projectId,
  organizationId,
  modelProviderId,
  providerKey,
}: EditModelProviderFormProps) => {
  const { providers } = useModelProvidersSettings({
    projectId: projectId,
  });
  const { closeDrawer } = useDrawer();
  const { project, team, organization, hasPermission } =
    useOrganizationTeamProject();
  const canManageOrganization = hasPermission("organization:manage");
  const canManageTeam = hasPermission("team:manage");

  // Count enabled providers to determine if this is the only one
  // Include the current provider being edited since it will be enabled when saved
  const enabledProvidersCount = useMemo(() => {
    if (!providers) return 1; // Current provider will be enabled when (if) saved
    const currentlyEnabledCount = Object.values(providers).filter(
      (p) => p.enabled,
    ).length;
    // If the current provider is not already enabled, add 1 since it will be enabled when saved
    const isCurrentProviderAlreadyEnabled =
      providers[providerKey]?.enabled ?? false;
    return isCurrentProviderAlreadyEnabled
      ? currentlyEnabledCount
      : currentlyEnabledCount + 1;
  }, [providers, providerKey]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Advanced (Gateway) draft lives at the form root so the single Save
  // sends basic + advanced in one update mutation. Gated on the AI
  // Gateway feature flag — orgs without the gateway never see the
  // accordion AND the form never spreads advanced fields into the
  // payload, so toggling the flag has no payload-shape side effects.
  const { enabled: gatewayMenuEnabled } = useFeatureFlag(
    "release_ui_ai_gateway_menu_enabled",
    {
      organizationId: organization?.id,
      enabled: !!organization?.id,
    },
  );
  const [advancedDraft, setAdvancedDraft] =
    useState<ModelProviderAdvancedDraft>(EMPTY_ADVANCED_DRAFT);
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(
    null,
  );

  // Find the row this form is editing. Three inputs to the lookup:
  //   - `modelProviderId === "new"` → always blank, never pre-fill from
  //     an existing row. The Add Model Provider menu sets this so the
  //     user can stand up a second instance of an already-configured
  //     provider type without colliding with the first.
  //   - `modelProviderId === "<cuid>"` → edit that specific row. With
  //     multi-instance enabled the providers Record dedupes by provider
  //     string and may not contain this row, so we don't fall back on
  //     `providers[providerKey]` if the id lookup misses (that fallback
  //     used to silently swap the user's intended row for whichever
  //     same-type row happened to win the dedupe).
  //   - `modelProviderId` undefined → no specific target, fresh blank
  //     (deep-link from evaluator selector or similar).
  const provider: MaybeStoredModelProvider = useMemo(() => {
    if (providers && modelProviderId && modelProviderId !== "new") {
      const existing = Object.values(providers).find(
        (p) => p.id === modelProviderId,
      );
      if (existing) return existing;
    }
    return {
      provider: providerKey,
      enabled: false,
      customKeys: null,
      models: null,
      embeddingsModels: null,
      disabledByDefault: true,
      deploymentMapping: null,
      extraHeaders: [],
    };
  }, [modelProviderId, providerKey, providers]);

  // Detect if provider is using environment variables (enabled but no stored customKeys)
  // Must be computed before the hook call so we can pass it to the hook
  // Handles both null and empty object {} cases
  const isUsingEnvVars =
    provider.enabled &&
    (!provider.customKeys ||
      Object.keys(provider.customKeys as Record<string, unknown>).length === 0);

  // Reset advanced draft when the *drawer subject* changes — i.e. the
  // user opened the drawer on a different provider row. We intentionally
  // do NOT re-seed on every underlying-value change: a background
  // refetch (window focus, invalidation, concurrent edit in another
  // tab) re-runs this effect and would overwrite the user's in-progress
  // draft + clear their JSON error with no warning. Keying on the row
  // id + the flag preserves typed values across silent refetches.
  const providerId = (provider as { id?: string }).id;
  useEffect(() => {
    if (!gatewayMenuEnabled) {
      setAdvancedDraft(EMPTY_ADVANCED_DRAFT);
      setAdvancedJsonError(null);
      return;
    }
    setAdvancedDraft(
      draftFromProvider({
        rateLimitRpm:
          (provider as { rateLimitRpm?: number | null }).rateLimitRpm ?? null,
        rateLimitTpm:
          (provider as { rateLimitTpm?: number | null }).rateLimitTpm ?? null,
        rateLimitRpd:
          (provider as { rateLimitRpd?: number | null }).rateLimitRpd ?? null,
        fallbackPriorityGlobal:
          (provider as { fallbackPriorityGlobal?: number | null })
            .fallbackPriorityGlobal ?? null,
        providerConfig: (provider as { providerConfig?: unknown })
          .providerConfig,
      }),
    );
    setAdvancedJsonError(null);
    setAdvancedAccordionValue([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayMenuEnabled, providerId]);

  // The same expression the reset effect above uses — extracted so the
  // Save button's dirty check has something to diff the live draft
  // against. When the gateway flag is off we never render the section,
  // so the empty draft is the only valid initial.
  const initialAdvancedDraft = useMemo<ModelProviderAdvancedDraft>(() => {
    if (!gatewayMenuEnabled) return EMPTY_ADVANCED_DRAFT;
    return draftFromProvider({
      rateLimitRpm:
        (provider as { rateLimitRpm?: number | null }).rateLimitRpm ?? null,
      rateLimitTpm:
        (provider as { rateLimitTpm?: number | null }).rateLimitTpm ?? null,
      rateLimitRpd:
        (provider as { rateLimitRpd?: number | null }).rateLimitRpd ?? null,
      fallbackPriorityGlobal:
        (provider as { fallbackPriorityGlobal?: number | null })
          .fallbackPriorityGlobal ?? null,
      providerConfig: (provider as { providerConfig?: unknown }).providerConfig,
    });
  }, [gatewayMenuEnabled, provider]);
  const isAdvancedDirty =
    JSON.stringify(advancedDraft) !== JSON.stringify(initialAdvancedDraft);

  // Controlled accordion state: collapsed by default, but expands
  // automatically when the user clicks Save with malformed JSON so the
  // inline error is actually visible.
  const [advancedAccordionValue, setAdvancedAccordionValue] = useState<
    string[]
  >([]);

  const getAdvancedPayload = useCallback(() => {
    if (!gatewayMenuEnabled) return null;
    try {
      const parsed = parseAdvancedDraft(advancedDraft);
      setAdvancedJsonError(null);
      return parsed;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid JSON";
      setAdvancedJsonError(message);
      // Auto-expand the accordion so the inline error is visible. Save
      // would otherwise stop spinning + the drawer stay open with no
      // visible feedback if the user collapsed the section before save.
      setAdvancedAccordionValue(["advanced-gateway"]);
      throw e;
    }
  }, [gatewayMenuEnabled, advancedDraft]);

  // Use project data as primary source (auto-updates when organization.getAll is invalidated)
  // Effective defaults (project values with fallbacks) are computed inside the hook
  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    enabledProvidersCount,
    isUsingEnvVars,
    teamId: team?.id,
    organizationId: organization?.id,
    canManageOrganization,
    canManageTeam,
    getAdvancedPayload,
    onSuccess: () => {
      closeDrawer();
    },
  });

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const isLlmProvider = providerDefinition?.type === "llm";

  const {
    validate: validateApiKey,
    isValidating: isValidatingApiKey,
    validationError: apiKeyValidationError,
    clearError: clearApiKeyError,
  } = useModelProviderApiKeyValidation(
    provider.provider,
    state.customKeys,
    projectId,
  );

  const handleSave = useCallback(async () => {
    // Clear previous errors
    setFieldErrors({});
    clearApiKeyError();

    // Check if user entered a new API key
    const userEnteredNewApiKey = hasUserEnteredNewApiKey(state.customKeys);

    // Check if user modified non-API-key fields (like URLs)
    const hasNonApiKeyChanges = hasUserModifiedNonApiKeyFields(
      state.customKeys,
      state.initialKeys,
    );

    // Validate keys according to schema before submitting
    if (
      providerDefinition?.keysSchema &&
      (!isUsingEnvVars || hasNonApiKeyChanges)
    ) {
      const keysSchema = z.union([
        providerDefinition.keysSchema,
        z.object({ MANAGED: z.string() }),
      ]);

      const keysToValidate: Record<string, unknown> = { ...state.customKeys };
      const result = keysSchema.safeParse(keysToValidate);

      if (!result.success) {
        const parsedErrors = parseZodFieldErrors(
          result.error as ZodErrorStructure,
        );
        setFieldErrors(parsedErrors);
        return;
      }
    }

    // Only probe the upstream provider when the user has actually entered
    // a new API key. Re-probing the stored credentials on every save —
    // including saves that only touch unrelated fields like name or scope —
    // makes those edits depend on third-party uptime and rate-limits, and
    // blocks the user with a misleading "Invalid API key" toast whenever
    // the stored key has drifted out-of-band (rotated in the provider's
    // console, hit a temporary 401, etc.). Safety providers like
    // azure_safety also skip this — their endpoints can't answer the
    // OpenAI-compatible probe at all.
    if (isLlmProvider && userEnteredNewApiKey) {
      const isValid = await validateApiKey();
      if (!isValid) return;
    }

    void actions.submit();
  }, [
    isLlmProvider,
    isUsingEnvVars,
    providerDefinition,
    state.customKeys,
    state.initialKeys,
    actions,
    validateApiKey,
    clearApiKeyError,
  ]);

  return (
    <VStack gap={4} align="start" width="full">
      <VStack align="start" width="full" gap={4}>
        <Field.Root width="full" required>
          <SmallLabel>
            Name
            <Field.RequiredIndicator />
          </SmallLabel>
          <Box width="full">
            <Input
              value={state.name}
              onChange={(e) => actions.setName(e.target.value)}
              placeholder={provider.provider}
              width="full"
              maxLength={128}
            />
          </Box>
          <Field.HelperText>
            Distinguish multiple instances (e.g. "OpenAI – EU prod" vs "OpenAI –
            Dev").
          </Field.HelperText>
        </Field.Root>

        {isLlmProvider && provider.provider === "azure" && (
          <Field.Root>
            <Switch
              onCheckedChange={(details) => {
                actions.setUseApiGateway(details.checked);
              }}
              checked={state.useApiGateway}
            >
              Use API Gateway
            </Switch>
          </Field.Root>
        )}

        <ProviderScopeSection
          state={state}
          actions={actions}
          provider={provider}
          teamId={team?.id}
          teamName={team?.name}
          organizationId={organization?.id}
          organizationName={organization?.name}
          projectId={project?.id}
          projectName={project?.name}
          availableTeams={
            organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? []
          }
          availableProjects={
            organization?.teams?.flatMap((t) =>
              t.projects.map((p) => ({
                id: p.id,
                name: `${p.name} · ${t.name}`,
                teamId: t.id,
              })),
            ) ?? []
          }
        />

        <CredentialsSection
          state={state}
          actions={actions}
          provider={provider}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          projectId={projectId}
          organizationId={organizationId}
          apiKeyValidationError={apiKeyValidationError}
          onApiKeyValidationClear={clearApiKeyError}
        />

        <ExtraHeadersSection
          state={state}
          actions={actions}
          provider={provider}
        />

        {isLlmProvider && (
          <CustomModelInputSection
            state={state}
            actions={actions}
            provider={provider}
          />
        )}

        {gatewayMenuEnabled && (
          <ModelProviderAdvancedSection
            modelProviderId={(provider as { id?: string }).id}
            draft={advancedDraft}
            onDraftChange={(next) => {
              setAdvancedDraft(next);
              setAdvancedJsonError(null);
            }}
            jsonError={advancedJsonError}
            accordionValue={advancedAccordionValue}
            onAccordionValueChange={setAdvancedAccordionValue}
            initial={{
              healthStatus: (provider as { healthStatus?: string | null })
                .healthStatus,
              circuitOpenedAt: (
                provider as {
                  circuitOpenedAt?: Date | string | null;
                }
              ).circuitOpenedAt,
              lastHealthCheckAt: (
                provider as {
                  lastHealthCheckAt?: Date | string | null;
                }
              ).lastHealthCheckAt,
              disabledAt: (provider as { disabledAt?: Date | string | null })
                .disabledAt,
            }}
          />
        )}

        <HStack width="full" justify="end">
          <Button
            size="sm"
            colorPalette="orange"
            loading={state.isSaving || isValidatingApiKey}
            disabled={!state.isDirty && !isAdvancedDirty}
            onClick={handleSave}
          >
            Save
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
};
