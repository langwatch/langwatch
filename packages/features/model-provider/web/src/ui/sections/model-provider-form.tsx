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
} from "../../behavior/use-all-model-providers-list.ts";
import { useCredentialProbeGate } from "../../behavior/use-credential-probe-gate.ts";
import { useDrawer } from "@langwatch/ui-drawer";
import { useFeatureFlag } from "@langwatch/workflow-web/surfaces/feature-flag";
import { useModelProviderApiKeyValidation } from "../../behavior/use-model-provider-api-key-validation.ts";
import { useModelProviderForm } from "../../behavior/use-model-provider-form.ts";
import { useModelProvidersSettings } from "../../behavior/use-model-providers-settings.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import type { AdvancedGatewayPayload } from "../../behavior/use-provider-form-submit.ts";
import { useRequiredCredentialKeys } from "../../behavior/use-required-credential-keys.ts";
import {
  type ModelProviderEditorValue,
  modelProviders as modelProvidersRegistry,
} from "@langwatch/model-provider-contract";
import {
  getEmptyRequiredCredentialKeys,
  hasUserEnteredNewApiKey,
  hasUserModifiedNonApiKeyFields,
} from "../../model/model-provider-helpers.ts";
import { parseZodFieldErrors, type ZodErrorStructure } from "../../model/zod-field-errors.ts";
import { SmallLabel } from "../elements/small-label.tsx";
import { Switch } from "@langwatch/design-system/switch";
import { useModelProviderToaster } from "../../behavior/model-provider-feedback.ts";
import { useCodexCodingDefaultsAskStore } from "./codex-coding-defaults-ask.tsx";
import { CodexSignIn } from "./codex-sign-in.tsx";
import {
  ADVANCED_ACCORDION_VALUE,
  draftFromProvider,
  EMPTY_ADVANCED_DRAFT,
  type ModelProviderAdvancedDraft,
  ModelProviderAdvancedSection,
  parseAdvancedDraft,
  parseSkipPermissionsDraft,
} from "./model-provider-advanced-section.tsx";
import { CredentialsSection } from "./model-provider-credentials-section.tsx";
import { CustomModelInputSection } from "./model-provider-custom-model-input.tsx";
// DefaultProviderSection has been moved out of this drawer to a page-level
// section on the model-providers settings page (DefaultModelsSection). See
// specs/model-providers/hierarchical-default-models.feature.
import { ExtraHeadersSection } from "./model-provider-extra-headers-section.tsx";
import { ModelProviderRoutingSection } from "./model-provider-routing-section.tsx";
import { ProviderScopeSection } from "./model-provider-scope-section.tsx";
import type { TimeInput } from "@langwatch/time";

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

/**
 * The current provider counts as enabled: it will be when the form saves.
 * Nothing loaded yet means one, for the same reason.
 */
function countEnabledProviders({
  providerKey,
  providers,
}: {
  providerKey: string;
  providers: Record<string, { enabled?: boolean }> | undefined;
}): number {
  if (!providers) return 1;

  const currentlyEnabled = Object.values(providers).filter((candidate) => candidate.enabled).length;
  const alreadyEnabled = providers[providerKey]?.enabled ?? false;

  return alreadyEnabled ? currentlyEnabled : currentlyEnabled + 1;
}

/** Enabled with no stored credentials means the environment supplies them. */
function readsCredentialsFromEnvironment(provider: ModelProviderEditorValue): boolean {
  if (!provider.enabled) return false;

  const stored = provider.customKeys as Record<string, unknown> | null;

  return !stored || Object.keys(stored).length === 0;
}

/**
 * The draft the drawer opens with. The skip-permissions list is always
 * seeded, because that field does not belong to the gateway; the gateway
 * knobs are seeded only when their section renders, so toggling the flag has
 * no payload-shape side effects.
 */
function initialDraftFor({
  gatewayMenuEnabled,
  provider,
}: {
  gatewayMenuEnabled: boolean;
  provider: ModelProviderEditorValue;
}): ModelProviderAdvancedDraft {
  const seeded = draftFromProvider({
    rateLimitRpm: provider.rateLimitRpm ?? null,
    rateLimitTpm: provider.rateLimitTpm ?? null,
    rateLimitRpd: provider.rateLimitRpd ?? null,
    fallbackPriorityGlobal: provider.fallbackPriorityGlobal ?? null,
    providerConfig: provider.providerConfig,
    langySkipPermissionsModels: provider.langySkipPermissionsModels ?? null,
  });
  if (gatewayMenuEnabled) return seeded;

  return { ...EMPTY_ADVANCED_DRAFT, skipPermissionsModels: seeded.skipPermissionsModels };
}

/**
 * The advanced half of the payload. A malformed providerConfig raises, after
 * reporting itself on the field it came from.
 */
function buildAdvancedPayload({
  advancedDraft,
  gatewayMenuEnabled,
  onJsonError,
  onJsonParsed,
  showSkipPermissionsField,
}: {
  advancedDraft: ModelProviderAdvancedDraft;
  gatewayMenuEnabled: boolean;
  onJsonError: (error: unknown) => void;
  onJsonParsed: () => void;
  showSkipPermissionsField: boolean;
}): AdvancedGatewayPayload | null {
  const langySkipPermissionsModels = showSkipPermissionsField
    ? parseSkipPermissionsDraft(advancedDraft)
    : undefined;
  if (!gatewayMenuEnabled) {
    if (langySkipPermissionsModels === undefined) return null;

    return { gateway: null, langySkipPermissionsModels };
  }

  try {
    const gateway = parseAdvancedDraft(advancedDraft);
    onJsonParsed();

    return { gateway, langySkipPermissionsModels };
  } catch (e) {
    onJsonError(e);
    throw e;
  }
}

/**
 * A rule that spans several credentials (an API key, or a base URL instead)
 * names no single field, so it has no path to land on and would leave Save
 * doing nothing visible. It anchors on a required field left empty.
 */
function anchorSchemaWideMessage({
  displayKeys,
  fieldErrors,
  requiredKeys,
  values,
  zodError,
}: {
  displayKeys: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  requiredKeys: Set<string>;
  values: Record<string, string>;
  zodError: ZodErrorStructure;
}): void {
  const schemaWideMessage = zodError.issues.find((issue) => !issue.path?.length)?.message;
  if (!schemaWideMessage) return;

  const anchorKey =
    getEmptyRequiredCredentialKeys({ requiredKeys, values })[0] ?? Object.keys(displayKeys)[0];
  if (!anchorKey || fieldErrors[anchorKey]) return;

  fieldErrors[anchorKey] = schemaWideMessage;
}

/**
 * The credential refusals keyed by field, or null when the keys parse.
 * oauth-device providers skip the check entirely: the user never types
 * credentials here, so a name or scope-only save must not trip on the token
 * schema.
 */
function findCredentialFieldErrors({
  displayKeys,
  hasNonApiKeyChanges,
  isOAuthDeviceProvider,
  isUsingEnvVars,
  keysSchema,
  requiredKeys,
  values,
}: {
  displayKeys: Record<string, unknown>;
  hasNonApiKeyChanges: boolean;
  isOAuthDeviceProvider: boolean;
  isUsingEnvVars: boolean;
  keysSchema: z.ZodTypeAny | undefined;
  requiredKeys: Set<string>;
  values: Record<string, string>;
}): Record<string, string> | null {
  const mustValidate = !isUsingEnvVars || hasNonApiKeyChanges;
  if (!keysSchema || isOAuthDeviceProvider || !mustValidate) return null;

  const schema = z.union([keysSchema, z.object({ MANAGED: z.string() })]);
  const result = schema.safeParse({ ...values });
  if (result.success) return null;

  const zodError = result.error as ZodErrorStructure;
  const fieldErrors = parseZodFieldErrors(zodError);
  anchorSchemaWideMessage({ displayKeys, fieldErrors, requiredKeys, values, zodError });

  return fieldErrors;
}

/** Whether the save may proceed: a refused credential stops it here. */
async function probeCredential({
  clearRefusal,
  recordRefusal,
  validateApiKey,
}: {
  clearRefusal: () => void;
  recordRefusal: () => void;
  validateApiKey: () => Promise<boolean>;
}): Promise<boolean> {
  const isValid = await validateApiKey();
  if (!isValid) {
    recordRefusal();

    return false;
  }
  clearRefusal();

  return true;
}

function finishSave({
  closeDrawer,
  onSaved,
}: {
  closeDrawer: () => void;
  onSaved?: () => void;
}): void {
  if (onSaved) {
    onSaved();

    return;
  }
  closeDrawer();
}

/**
 * Credentials, or the provider's own sign-in flow. oauth-device providers
 * (codex) credential through that flow: the drawer swaps the API-key fields
 * for it, and the sign-in poll has already persisted the row server-side, so
 * the drawer's Save has nothing left to do. The coding-defaults ask is queued
 * to the page-level host — a dialog mounted in this drawer would be unmounted
 * the moment it opened.
 */
function ProviderCredentialsArea({
  actions,
  apiKeyValidationError,
  clearApiKeyError,
  closeDrawer,
  fieldErrors,
  isOAuthDeviceProvider,
  onSaved,
  organizationId,
  projectId,
  provider,
  setFieldErrors,
  state,
  toaster,
}: {
  actions: ReturnType<typeof useModelProviderForm>[1];
  apiKeyValidationError: string | undefined;
  clearApiKeyError: () => void;
  closeDrawer: () => void;
  fieldErrors: Record<string, string>;
  isOAuthDeviceProvider: boolean;
  onSaved?: () => void;
  organizationId?: string;
  projectId: string;
  provider: ModelProviderEditorValue;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  state: ReturnType<typeof useModelProviderForm>[0];
  toaster: ReturnType<typeof useModelProviderToaster>;
}) {
  if (!isOAuthDeviceProvider) {
    return (
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
    );
  }

  return (
    <CodexSignIn
      projectId={projectId}
      scopes={state.scopes}
      setAsCodingDefaults={false}
      onConnected={(account) => {
        useCodexCodingDefaultsAskStore.getState().request({ projectId, scopes: state.scopes });
        toaster.create({
          title: "Codex connected",
          description: account.email ? `Signed in as ${account.email}` : undefined,
          type: "success",
        });
        finishSave({ closeDrawer, onSaved });
      }}
    />
  );
}

/** Azure's own gateway toggle; every other provider has nothing to switch. */
type OrganizationTeams = {
  teams?: Array<{ id: string; name: string; projects: Array<{ id: string; name: string }> }>;
};

function availableTeamsOf(organization: OrganizationTeams | undefined) {
  return (organization?.teams ?? []).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
  }));
}

/** Projects read as "project · team", so two same-named projects stay apart. */
function availableProjectsOf(organization: OrganizationTeams | undefined) {
  return (organization?.teams ?? []).flatMap((candidateTeam) =>
    candidateTeam.projects.map((candidateProject) => ({
      id: candidateProject.id,
      name: `${candidateProject.name} · ${candidateTeam.name}`,
      teamId: candidateTeam.id,
    })),
  );
}

function ProviderNameField({
  actions,
  provider,
  state,
}: {
  actions: ReturnType<typeof useModelProviderForm>[1];
  provider: ModelProviderEditorValue;
  state: ReturnType<typeof useModelProviderForm>[0];
}) {
  return (
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
  );
}

function ApiGatewaySwitch({
  actions,
  isLlmProvider,
  provider,
  state,
}: {
  actions: ReturnType<typeof useModelProviderForm>[1];
  isLlmProvider: boolean;
  provider: ModelProviderEditorValue;
  state: ReturnType<typeof useModelProviderForm>[0];
}) {
  const isAzureLlm = isLlmProvider && provider.provider === "azure";
  if (!isAzureLlm) return null;

  return (
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
  );
}

/** Neither half renders when the organization has no gateway and no Langy models. */
function ProviderAdvancedArea({
  accordionValue,
  draft,
  jsonError,
  onAccordionValueChange,
  onDraftChange,
  provider,
  showGatewayFields,
  showSkipPermissionsField,
  skipPermissionsError,
  skipPermissionsPlaceholder,
}: {
  accordionValue: string[];
  draft: ModelProviderAdvancedDraft;
  jsonError: string | null;
  onAccordionValueChange: (value: string[]) => void;
  onDraftChange: (next: ModelProviderAdvancedDraft) => void;
  provider: ModelProviderEditorValue;
  showGatewayFields: boolean;
  showSkipPermissionsField: boolean;
  skipPermissionsError: string | null;
  skipPermissionsPlaceholder: string;
}) {
  if (!showGatewayFields && !showSkipPermissionsField) return null;

  const row = provider as {
    id?: string;
    healthStatus?: string | null;
    circuitOpenedAt?: TimeInput | null;
    lastHealthCheckAt?: TimeInput | null;
    disabledAt?: TimeInput | null;
  };

  return (
    <ModelProviderAdvancedSection
      modelProviderId={row.id}
      draft={draft}
      onDraftChange={onDraftChange}
      jsonError={jsonError}
      skipPermissionsError={skipPermissionsError}
      skipPermissionsPlaceholder={skipPermissionsPlaceholder}
      showGatewayFields={showGatewayFields}
      showSkipPermissionsField={showSkipPermissionsField}
      accordionValue={accordionValue}
      onAccordionValueChange={onAccordionValueChange}
      initial={{
        healthStatus: row.healthStatus,
        circuitOpenedAt: row.circuitOpenedAt,
        lastHealthCheckAt: row.lastHealthCheckAt,
        disabledAt: row.disabledAt,
      }}
    />
  );
}

function SaveProviderButton({
  canResolveTarget,
  isBusy,
  isDirty,
  label,
  onSave,
}: {
  canResolveTarget: boolean;
  isBusy: boolean;
  isDirty: boolean;
  label: string;
  onSave: () => void;
}) {
  return (
    <HStack width="full" justify="end">
      <Button
        size="sm"
        colorPalette="orange"
        loading={isBusy}
        disabled={!canResolveTarget || !isDirty}
        onClick={onSave}
      >
        {label}
      </Button>
    </HStack>
  );
}

/** Routing handle and custom models: both are LLM-provider concerns only. */
function ProviderModelSections({
  actions,
  isLlmProvider,
  isOAuthDeviceProvider,
  provider,
  state,
}: {
  actions: ReturnType<typeof useModelProviderForm>[1];
  isLlmProvider: boolean;
  isOAuthDeviceProvider: boolean;
  provider: ModelProviderEditorValue;
  state: ReturnType<typeof useModelProviderForm>[0];
}) {
  if (!isLlmProvider) return null;

  return (
    <>
      <ModelProviderRoutingSection
        providerKey={provider.provider}
        routingHandle={state.routingHandle}
        onRoutingHandleChange={actions.setRoutingHandle}
      />
      {!isOAuthDeviceProvider && (
        <CustomModelInputSection state={state} actions={actions} provider={provider} />
      )}
    </>
  );
}

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

  const enabledProvidersCount = useMemo(
    () => countEnabledProviders({ providerKey, providers }),
    [providers, providerKey],
  );

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
    // `modelProviderId === "new"` never resolves, so the Add Model Provider
    // menu can stand up a second instance without colliding with the first.
    () => findModelProviderById({ providers: allProviders, modelProviderId }),
    [allProviders, modelProviderId],
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

  // Computed before the hook call so it can be passed to the hook.
  const isUsingEnvVars = readsCredentialsFromEnvironment(provider);

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

  const initialAdvancedDraft = useMemo<ModelProviderAdvancedDraft>(
    () => initialDraftFor({ gatewayMenuEnabled, provider }),
    [gatewayMenuEnabled, provider],
  );

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

  const getAdvancedPayload = useCallback(
    (): AdvancedGatewayPayload | null =>
      buildAdvancedPayload({
        advancedDraft,
        gatewayMenuEnabled,
        onJsonError: reportAdvancedJsonError,
        onJsonParsed: () => setAdvancedJsonError(null),
        showSkipPermissionsField,
      }),
    [gatewayMenuEnabled, showSkipPermissionsField, advancedDraft, reportAdvancedJsonError],
  );

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
    onSuccess: () => finishSave({ closeDrawer, onSaved }),
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

    const credentialErrors = findCredentialFieldErrors({
      displayKeys: state.displayKeys,
      hasNonApiKeyChanges,
      isOAuthDeviceProvider,
      isUsingEnvVars: Boolean(isUsingEnvVars),
      keysSchema: providerDefinition?.keysSchema,
      requiredKeys,
      values: state.customKeys,
    });
    if (credentialErrors) {
      setFieldErrors(credentialErrors);
      return;
    }

    // Only probe the upstream provider when the user has actually entered a new API key.
    const needsProbe =
      isLlmProvider && !isOAuthDeviceProvider && userEnteredNewApiKey && probeRequired;
    if (needsProbe && !(await probeCredential({ clearRefusal, recordRefusal, validateApiKey }))) {
      return;
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
        <ProviderNameField actions={actions} provider={provider} state={state} />

        <ApiGatewaySwitch
          actions={actions}
          isLlmProvider={isLlmProvider}
          provider={provider}
          state={state}
        />

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
          availableTeams={availableTeamsOf(organization)}
          availableProjects={availableProjectsOf(organization)}
        />

        <ProviderCredentialsArea
          actions={actions}
          apiKeyValidationError={apiKeyValidationError}
          clearApiKeyError={clearApiKeyError}
          closeDrawer={closeDrawer}
          fieldErrors={fieldErrors}
          isOAuthDeviceProvider={isOAuthDeviceProvider}
          onSaved={onSaved}
          organizationId={organizationId}
          projectId={project?.id ?? ""}
          provider={provider}
          setFieldErrors={setFieldErrors}
          state={state}
          toaster={toaster}
        />

        <ExtraHeadersSection state={state} actions={actions} provider={provider} />

        <ProviderModelSections
          actions={actions}
          isLlmProvider={isLlmProvider}
          isOAuthDeviceProvider={isOAuthDeviceProvider}
          provider={provider}
          state={state}
        />

        <ProviderAdvancedArea
          accordionValue={advancedAccordionValue}
          draft={advancedDraft}
          jsonError={advancedJsonError}
          onAccordionValueChange={setAdvancedAccordionValue}
          onDraftChange={(next) => {
            setAdvancedDraft(next);
            setAdvancedJsonError(null);
            setSkipPermissionsError(null);
          }}
          provider={provider}
          showGatewayFields={gatewayMenuEnabled}
          showSkipPermissionsField={showSkipPermissionsField}
          skipPermissionsError={skipPermissionsError}
          skipPermissionsPlaceholder={skipPermissionsPlaceholder}
        />

        <SaveProviderButton
          canResolveTarget={!cannotResolveTarget}
          isDirty={state.isDirty || isAdvancedDirty}
          isBusy={state.isSaving || isValidatingApiKey}
          label={saveLabel}
          onSave={handleSave}
        />
      </VStack>
    </VStack>
  );
};
