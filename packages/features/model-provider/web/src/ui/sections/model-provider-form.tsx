import { Box, Button, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import { skipListToInput } from "@langwatch/model-provider-contract";
import {
  findModelProviderById,
  isResolvableProviderId,
  useAllModelProvidersList,
} from "../../behavior/use-all-model-providers-list";
import { useCredentialProbeGate } from "../../behavior/use-credential-probe-gate";
import { useDrawer } from "@langwatch/ui-drawer";
import { useFeatureFlag } from "@langwatch/workflow-web/surfaces/feature-flag";
import { useModelProviderApiKeyValidation } from "../../behavior/use-model-provider-api-key-validation";
import { useModelProviderForm } from "../../behavior/use-model-provider-form";
import { useModelProvidersSettings } from "../../behavior/use-model-providers-settings";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import type { AdvancedGatewayPayload } from "../../behavior/use-provider-form-submit";
import { useRequiredCredentialKeys } from "../../behavior/use-required-credential-keys";
import {
  type ModelProviderEditorValue,
  modelProviders as modelProvidersRegistry,
} from "@langwatch/model-provider-contract";
import {
  getEmptyRequiredCredentialKeys,
  hasUserEnteredNewApiKey,
  hasUserModifiedNonApiKeyFields,
} from "../../model/model-provider-helpers";
import { parseZodFieldErrors, type ZodErrorStructure } from "../../model/zod-field-errors";
import { SmallLabel } from "../elements/small-label";
import { Switch } from "@langwatch/design-system/switch";
import { useModelProviderToaster } from "../../behavior/model-provider-feedback";
import { useCodexCodingDefaultsAskStore } from "./codex-coding-defaults-ask";
import { CodexSignIn } from "./codex-sign-in";
import {
  ADVANCED_ACCORDION_VALUE,
  draftFromProvider,
  EMPTY_ADVANCED_DRAFT,
  type ModelProviderAdvancedDraft,
  ModelProviderAdvancedSection,
  parseAdvancedDraft,
  parseSkipPermissionsDraft,
} from "./model-provider-advanced-section";
import { CredentialsSection } from "./model-provider-credentials-section";
import { CustomModelInputSection } from "./model-provider-custom-model-input";
// DefaultProviderSection has been moved out of this drawer to a page-level
// section on the model-providers settings page (DefaultModelsSection). See
// specs/model-providers/hierarchical-default-models.feature.
import { ExtraHeadersSection } from "./model-provider-extra-headers-section";
import { ModelProviderRoutingSection } from "./model-provider-routing-section";
import { ProviderScopeSection } from "./model-provider-scope-section";

/**
 * The message the server attached to the skip-permissions field, or null when
 * the failure was about something else. `meta.fieldErrors` comes off the wire,
 * so nothing about its shape is trusted.
 */
function readSkipPermissionsFieldError(fieldErrors: unknown): string | null {
  if (!fieldErrors || typeof fieldErrors !== "object") return null;
  const entry = (fieldErrors as Record<string, unknown>).langySkipPermissionsModels;
  const message = Array.isArray(entry) ? entry[0] : entry;
  return typeof message === "string" && message !== "" ? message : null;
}

export type EditModelProviderFormProps = {
  projectId?: string | undefined;
  organizationId?: string | undefined;
  modelProviderId?: string;
  providerKey: string;
  /**
   * What "the credential is saved" means to a surface that is not a drawer.
   * The onboarding step passes its advance here; without it the form closes
   * the drawer it was written for.
   */
  onSaved?: () => void;
};

export const EditModelProviderForm = ({
  projectId,
  organizationId,
  modelProviderId,
  providerKey,
  onSaved,
}: EditModelProviderFormProps) => {
  const { providers } = useModelProvidersSettings({
    projectId: projectId,
  });
  // Flat, uncollapsed list — see useAllModelProvidersList for why the
  // lookup below can't use the collapsed `providers` Record above.
  // `isAllProvidersReady` is the hook's "the list definitively arrived"
  // signal (react-query isSuccess), used below to tell a real stale miss
  // apart from a list that simply hasn't loaded.
  const { providers: allProviders, isReady: isAllProvidersReady } = useAllModelProvidersList();
  const { closeDrawer } = useDrawer();
  const toaster = useModelProviderToaster();
  const { project, team, organization, hasPermission } = useOrganizationTeamProject();
  const canManageOrganization = hasPermission("organization:manage");
  const canManageTeam = hasPermission("team:manage");

  // Count enabled providers to determine if this is the only one
  // Include the current provider being edited since it will be enabled when saved
  const enabledProvidersCount = useMemo(() => {
    if (!providers) return 1; // Current provider will be enabled when (if) saved
    const currentlyEnabledCount = Object.values(providers).filter(
      (candidate) => (candidate as { enabled?: boolean }).enabled,
    ).length;
    // If the current provider is not already enabled, add 1 since it will be enabled when saved
    const isCurrentProviderAlreadyEnabled = providers[providerKey]?.enabled ?? false;
    return isCurrentProviderAlreadyEnabled ? currentlyEnabledCount : currentlyEnabledCount + 1;
  }, [providers, providerKey]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Advanced (Gateway) draft lives at the form root so the single Save
  // sends basic + advanced in one update mutation. Gated on the AI
  // Gateway feature flag — orgs without the gateway never see the
  // accordion AND the form never spreads advanced fields into the
  // payload, so toggling the flag has no payload-shape side effects.
  const { enabled: gatewayMenuEnabled } = useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    enabled: !!organization?.id,
  });
  const [advancedDraft, setAdvancedDraft] =
    useState<ModelProviderAdvancedDraft>(EMPTY_ADVANCED_DRAFT);
  const [advancedJsonError, setAdvancedJsonError] = useState<string | null>(null);
  // The server's refusal for the skip-permissions list, rendered on the field
  // it names rather than in a toast.
  const [skipPermissionsError, setSkipPermissionsError] = useState<string | null>(null);

  // Find the row this form is editing. Three inputs to the lookup: - `modelProviderId ===
  // "new"` → always blank, never pre-fill from an existing row. The Add Model Provider menu
  // sets this so the user can stand up a second instance of an already-configured provider type
  // without colliding with the first.
  const isTargetingSpecificRow = isResolvableProviderId(modelProviderId);
  const existingRow = useMemo(
    () =>
      isTargetingSpecificRow
        ? findModelProviderById({ providers: allProviders, modelProviderId })
        : undefined,
    [isTargetingSpecificRow, allProviders, modelProviderId],
  );

  // Two DISTINCT concerns, deliberately not collapsed into one flag: - Whether we can SUBMIT.
  // An id-targeted edit that didn't resolve to a real row must never submit, in EVERY load
  // state (loading, disabled, errored, or genuinely empty), so this gates purely on "targeting
  // a row we couldn't resolve". Otherwise Save ships `id: undefined`, the server treats it as a
  // create, and a phantom duplicate row is written (#5380 P2).
  const cannotResolveTarget = isTargetingSpecificRow && !existingRow;
  // - Whether to show the "no longer exists" copy. This is the subset of `cannotResolveTarget`
  // where the flat list has DEFINITIVELY arrived, so the row is known absent rather than merely
  // unresolved. Gating on readiness stops the copy flashing mid-load and stops it lying when
  // the list simply failed to load.
  const isStaleMiss = cannotResolveTarget && isAllProvidersReady;

  // Memoized so the blank template keeps a stable identity across renders:
  // useModelProviderForm's reset effect lists `provider.extraHeaders` in its deps, so a fresh
  // `{ ..., extraHeaders: [] }` literal on every render would refire that effect each render →
  // setState → re-render → "Maximum update depth exceeded" and a wiped-out Add form. Keyed on
  // the resolved row (or its absence) and the provider key only.
  const provider: ModelProviderEditorValue = useMemo(
    () =>
      existingRow ?? {
        provider: providerKey,
        enabled: false,
        customKeys: null,
        models: null,
        embeddingsModels: null,
        disabledByDefault: true,
        deploymentMapping: null,
        extraHeaders: [],
      },
    [existingRow, providerKey],
  );

  // Detect if provider is using environment variables (enabled but no stored customKeys)
  // Must be computed before the hook call so we can pass it to the hook
  // Handles both null and empty object {} cases
  const isUsingEnvVars =
    provider.enabled &&
    (!provider.customKeys ||
      Object.keys(provider.customKeys as Record<string, unknown>).length === 0);

  // Reset advanced draft when the *drawer subject* changes — i.e. the user opened the drawer on
  // a different provider row. We intentionally do NOT re-seed on every underlying-value change:
  // a background refetch (window focus, invalidation, concurrent edit in another tab) re-runs
  // this effect and would overwrite the user's in-progress draft + clear their JSON error with
  // no warning. Keying on the row id + the flag preserves typed values across silent refetches.
  const providerId = (provider as { id?: string }).id;

  const providerDefinition =
    modelProvidersRegistry[provider.provider as keyof typeof modelProvidersRegistry];

  const isLlmProvider = providerDefinition?.type === "llm";

  // Only an LLM provider serves the models a Langy conversation can run on,
  // so a credential container for a safety service has nothing to allow.
  const showSkipPermissionsField = isLlmProvider;

  // The provider's own default list, shown as placeholder text so an empty
  // field says what it falls back to rather than looking unset.
  const skipPermissionsPlaceholder = skipListToInput(
    providerDefinition?.langySkipPermissionsModels ?? [],
  );

  // The draft the drawer opens with. The skip-permissions list is always
  // seeded, because that field does not belong to the gateway; the gateway
  // knobs are seeded only when their section is rendered, so toggling the
  // flag has no payload-shape side effects.
  const initialAdvancedDraft = useMemo<ModelProviderAdvancedDraft>(() => {
    const seeded = draftFromProvider({
      rateLimitRpm: (provider as { rateLimitRpm?: number | null }).rateLimitRpm ?? null,
      rateLimitTpm: (provider as { rateLimitTpm?: number | null }).rateLimitTpm ?? null,
      rateLimitRpd: (provider as { rateLimitRpd?: number | null }).rateLimitRpd ?? null,
      fallbackPriorityGlobal:
        (provider as { fallbackPriorityGlobal?: number | null }).fallbackPriorityGlobal ?? null,
      providerConfig: (provider as { providerConfig?: unknown }).providerConfig,
      langySkipPermissionsModels:
        (provider as { langySkipPermissionsModels?: string[] | null }).langySkipPermissionsModels ??
        null,
    });
    if (gatewayMenuEnabled) return seeded;
    return {
      ...EMPTY_ADVANCED_DRAFT,
      skipPermissionsModels: seeded.skipPermissionsModels,
    };
  }, [gatewayMenuEnabled, provider]);

  useEffect(() => {
    setAdvancedDraft(initialAdvancedDraft);
    setAdvancedJsonError(null);
    setSkipPermissionsError(null);
    setAdvancedAccordionValue([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatewayMenuEnabled, providerId]);

  const isAdvancedDirty = JSON.stringify(advancedDraft) !== JSON.stringify(initialAdvancedDraft);

  // Controlled accordion state: collapsed by default, but expands
  // automatically when the user clicks Save with malformed JSON so the
  // inline error is actually visible.
  const [advancedAccordionValue, setAdvancedAccordionValue] = useState<string[]>([]);

  // Auto-expand the accordion so the inline error is visible. Save would
  // otherwise stop spinning + the drawer stay open with no visible feedback
  // if the user collapsed the section before save.
  const reportAdvancedJsonError = useCallback((e: unknown) => {
    setAdvancedJsonError(e instanceof Error ? e.message : "Invalid JSON");
    setAdvancedAccordionValue([ADVANCED_ACCORDION_VALUE]);
  }, []);

  const getAdvancedPayload = useCallback((): AdvancedGatewayPayload | null => {
    const langySkipPermissionsModels = showSkipPermissionsField
      ? parseSkipPermissionsDraft(advancedDraft)
      : undefined;
    if (!gatewayMenuEnabled) {
      return langySkipPermissionsModels === undefined
        ? null
        : { gateway: null, langySkipPermissionsModels };
    }
    try {
      const gateway = parseAdvancedDraft(advancedDraft);
      setAdvancedJsonError(null);
      return { gateway, langySkipPermissionsModels };
    } catch (e) {
      reportAdvancedJsonError(e);
      throw e;
    }
  }, [gatewayMenuEnabled, showSkipPermissionsField, advancedDraft, reportAdvancedJsonError]);

  // The server refuses a pattern that does not compile and names the field it
  // came from, so the refusal lands on the textarea and the accordion opens
  // to show it. Everything else keeps the toast.
  const handleSubmitError = useCallback((error: unknown) => {
    const handled = readHandledError(error);
    const message = readSkipPermissionsFieldError(handled?.meta.fieldErrors);
    if (!message) return;
    setSkipPermissionsError(message);
    setAdvancedAccordionValue([ADVANCED_ACCORDION_VALUE]);
  }, []);

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
    onError: handleSubmitError,
    onSuccess: () => {
      if (onSaved) {
        onSaved();
        return;
      }
      closeDrawer();
    },
  });

  // Same answer the credential fields render their required markers from.
  const requiredKeys = useRequiredCredentialKeys({
    providerKey: provider.provider,
    displayKeys: state.displayKeys,
    customKeys: state.customKeys,
  });

  // oauth-device providers (codex) credential through the provider's own sign-in flow: the
  // drawer swaps the API-key fields for it, and Save (name / scope edits) skips every API-key
  // validation path, since the sign-in already persisted the credentials server-side. Their
  // model list comes from the registry catalog, so the custom-models section is hidden too.
  const isOAuthDeviceProvider =
    (providerDefinition as { authFlow?: "api-key" | "oauth-device" } | undefined)?.authFlow ===
    "oauth-device";

  const {
    validate: validateApiKey,
    isValidating: isValidatingApiKey,
    validationError: apiKeyValidationError,
    clearError: clearApiKeyError,
  } = useModelProviderApiKeyValidation(
    provider.provider,
    state.customKeys,
    projectId,
    organization?.id,
    state.scopes,
  );

  // Shared with onboarding and the Langy model gate, so a refusal is not the
  // end of the road on one surface and a hard block on the next.
  const { probeRequired, recordRefusal, clearRefusal, saveLabel } = useCredentialProbeGate({
    customKeys: state.customKeys,
    resetKey: providerId,
  });

  const handleSave = useCallback(async () => {
    // Clear previous errors
    setFieldErrors({});
    clearApiKeyError();

    // Check if user entered a new API key
    const userEnteredNewApiKey = hasUserEnteredNewApiKey(state.customKeys);

    // Check if user modified non-API-key fields (like URLs)
    const hasNonApiKeyChanges = hasUserModifiedNonApiKeyFields(state.customKeys, state.initialKeys);

    // Validate keys according to schema before submitting. oauth-device
    // providers skip this entirely: the user never types credentials
    // here, so a name/scope-only save must not trip on the token schema.
    if (
      providerDefinition?.keysSchema &&
      !isOAuthDeviceProvider &&
      (!isUsingEnvVars || hasNonApiKeyChanges)
    ) {
      const keysSchema = z.union([
        providerDefinition.keysSchema,
        z.object({ MANAGED: z.string() }),
      ]);

      const keysToValidate: Record<string, unknown> = { ...state.customKeys };
      const result = keysSchema.safeParse(keysToValidate);

      if (!result.success) {
        const zodError = result.error as ZodErrorStructure;
        const parsedErrors = parseZodFieldErrors(zodError);
        // A rule that spans several credentials (an API key, or a base URL
        // instead) names no single field, so it has no path to land on and
        // would leave Save doing nothing visible. Anchor it on a required
        // field the customer has left empty.
        const schemaWideMessage = zodError.issues.find((issue) => !issue.path?.length)?.message;
        if (schemaWideMessage) {
          const anchorKey =
            getEmptyRequiredCredentialKeys({
              requiredKeys,
              values: state.customKeys,
            })[0] ?? Object.keys(state.displayKeys)[0];
          if (anchorKey && !parsedErrors[anchorKey]) {
            parsedErrors[anchorKey] = schemaWideMessage;
          }
        }
        setFieldErrors(parsedErrors);
        return;
      }
    }

    // Only probe the upstream provider when the user has actually entered a new API key.
    if (isLlmProvider && !isOAuthDeviceProvider && userEnteredNewApiKey && probeRequired) {
      const isValid = await validateApiKey();
      if (!isValid) {
        recordRefusal();
        return;
      }
      clearRefusal();
    }

    void actions.submit();
  }, [
    probeRequired,
    recordRefusal,
    clearRefusal,
    isLlmProvider,
    isOAuthDeviceProvider,
    isUsingEnvVars,
    providerDefinition,
    requiredKeys,
    state.customKeys,
    state.displayKeys,
    state.initialKeys,
    actions,
    validateApiKey,
    clearApiKeyError,
  ]);

  return (
    <VStack gap={4} align="start" width="full">
      {isStaleMiss && (
        <Text color="red.500" fontSize="sm">
          This provider configuration no longer exists. It may have been deleted from another
          session.
        </Text>
      )}
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
            Distinguish multiple instances (e.g. "OpenAI – EU prod" vs "OpenAI – Dev").
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
            organization?.teams?.map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
            })) ?? []
          }
          availableProjects={
            organization?.teams?.flatMap((candidateTeam) =>
              candidateTeam.projects.map((candidateProject) => ({
                id: candidateProject.id,
                name: `${candidateProject.name} · ${candidateTeam.name}`,
                teamId: candidateTeam.id,
              })),
            ) ?? []
          }
        />

        {isOAuthDeviceProvider ? (
          <CodexSignIn
            projectId={project?.id ?? ""}
            scopes={state.scopes}
            setAsCodingDefaults={false}
            onConnected={(account) => {
              // The sign-in poll already persisted the provider row
              // server-side, so the drawer's Save has nothing left to do:
              // close it over the refreshed list. The coding-defaults ask
              // is queued to the page-level host (a dialog mounted in this
              // drawer would be unmounted right here, mid-question).
              useCodexCodingDefaultsAskStore.getState().request({
                projectId: project?.id ?? "",
                scopes: state.scopes,
              });
              toaster.create({
                title: "Codex connected",
                description: account.email ? `Signed in as ${account.email}` : undefined,
                type: "success",
              });
              if (onSaved) {
                onSaved();
                return;
              }
              closeDrawer();
            }}
          />
        ) : (
          <CredentialsSection
            state={state}
            actions={actions}
            provider={provider}
            fieldErrors={fieldErrors}
            setFieldErrors={setFieldErrors}
            organizationId={organizationId}
            apiKeyValidationError={apiKeyValidationError}
            onApiKeyValidationClear={clearApiKeyError}
          />
        )}

        <ExtraHeadersSection state={state} actions={actions} provider={provider} />

        {isLlmProvider && (
          <ModelProviderRoutingSection
            providerKey={provider.provider}
            routingHandle={state.routingHandle}
            onRoutingHandleChange={actions.setRoutingHandle}
          />
        )}

        {isLlmProvider && !isOAuthDeviceProvider && (
          <CustomModelInputSection state={state} actions={actions} provider={provider} />
        )}

        {(gatewayMenuEnabled || showSkipPermissionsField) && (
          <ModelProviderAdvancedSection
            modelProviderId={(provider as { id?: string }).id}
            draft={advancedDraft}
            onDraftChange={(next) => {
              setAdvancedDraft(next);
              setAdvancedJsonError(null);
              setSkipPermissionsError(null);
            }}
            jsonError={advancedJsonError}
            skipPermissionsError={skipPermissionsError}
            skipPermissionsPlaceholder={skipPermissionsPlaceholder}
            showGatewayFields={gatewayMenuEnabled}
            showSkipPermissionsField={showSkipPermissionsField}
            accordionValue={advancedAccordionValue}
            onAccordionValueChange={setAdvancedAccordionValue}
            initial={{
              healthStatus: (provider as { healthStatus?: string | null }).healthStatus,
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
              disabledAt: (provider as { disabledAt?: Date | string | null }).disabledAt,
            }}
          />
        )}

        <HStack width="full" justify="end">
          <Button
            size="sm"
            colorPalette="orange"
            loading={state.isSaving || isValidatingApiKey}
            disabled={cannotResolveTarget || (!state.isDirty && !isAdvancedDirty)}
            onClick={handleSave}
          >
            {saveLabel}
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
};
