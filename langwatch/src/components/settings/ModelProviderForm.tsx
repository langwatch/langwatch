import {
  VStack,
  HStack,
  Button,
  Field,
} from "@chakra-ui/react";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useModelProviderForm } from "../../hooks/useModelProviderForm";
import { useModelProviderApiKeyValidation } from "../../hooks/useModelProviderApiKeyValidation";
import { useDrawer } from "../../hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import {
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../../server/modelProviders/registry";
import { parseZodFieldErrors, type ZodErrorStructure } from "../../utils/zod";
import { hasUserEnteredNewApiKey, hasUserModifiedNonApiKeyFields } from "../../utils/modelProviderHelpers";
import { Switch } from "../ui/switch";
import { CredentialsSection } from "./ModelProviderCredentialsSection";
import { ExtraHeadersSection } from "./ModelProviderExtraHeadersSection";
import { CustomModelInputSection } from "./ModelProviderCustomModelInput";
import { DefaultProviderSection } from "./ModelProviderDefaultSection";

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
  const { project } = useOrganizationTeamProject();

  // Count enabled providers to determine if this is the only one
  // Include the current provider being edited since it will be enabled when saved
  const enabledProvidersCount = useMemo(() => {
    if (!providers) return 1; // Current provider will be enabled when (if) saved
    const currentlyEnabledCount = Object.values(providers).filter((p) => p.enabled).length;
    // If the current provider is not already enabled, add 1 since it will be enabled when saved
    const isCurrentProviderAlreadyEnabled = providers[providerKey]?.enabled ?? false;
    return isCurrentProviderAlreadyEnabled ? currentlyEnabledCount : currentlyEnabledCount + 1;
  }, [providers, providerKey]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Get provider - first try by ID, then fallback to provider key
  const provider: MaybeStoredModelProvider = useMemo(() => {
    if (providers) {
      // First try to find by ID
      if (modelProviderId) {
        const existing = Object.values(providers).find(
          (p) => p.id === modelProviderId,
        );
        if (existing) return existing;
      }
      // Fallback: find by provider key
      const byKey = providers[providerKey];
      if (byKey) return byKey;
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

  // Use project data as primary source (auto-updates when organization.getAll is invalidated)
  // Effective defaults (project values with fallbacks) are computed inside the hook
  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    project,
    isUsingEnvVars,
    onSuccess: () => {
      closeDrawer();
    },
  });

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const { validate: validateApiKey, isValidating: isValidatingApiKey, validationError: apiKeyValidationError, clearError: clearApiKeyError } = useModelProviderApiKeyValidation(
    provider.provider,
    state.customKeys,
    projectId,
  );

  const handleSave = useCallback(async () => {
    // Clear previous errors
    setFieldErrors({});
    clearApiKeyError();

    // Determine if we should validate API keys:
    // - Always validate if not using env vars
    // - Also validate if user entered a new API key (replacing masked env var key)
    const shouldValidateApiKey =
      !isUsingEnvVars || hasUserEnteredNewApiKey(state.customKeys);

    // Check if user modified non-API-key fields (like URLs)
    const hasNonApiKeyChanges = hasUserModifiedNonApiKeyFields(
      state.customKeys,
      state.initialKeys
    );

    // Skip all validation only if using env vars AND no changes at all
    if (isUsingEnvVars && !shouldValidateApiKey && !hasNonApiKeyChanges) {
      void actions.submit();
      return;
    }
    
    // Validate keys according to schema before submitting
    // Run Zod validation if not using env vars OR if there are non-API-key changes
    if (providerDefinition?.keysSchema && (!isUsingEnvVars || hasNonApiKeyChanges)) {
      const keysSchema = z.union([
        providerDefinition.keysSchema,
        z.object({ MANAGED: z.string() }),
      ]);
      
      const keysToValidate: Record<string, unknown> = { ...state.customKeys };
      const result = keysSchema.safeParse(keysToValidate);
      
      if (!result.success) {
        // Parse the Zod error to get field-specific errors
        const parsedErrors = parseZodFieldErrors(result.error as ZodErrorStructure);
        setFieldErrors(parsedErrors);
        return;
      }
    }

    // Validate API key if provider supports it and we should validate
    if (shouldValidateApiKey) {
      const isValid = await validateApiKey();
      if (!isValid) {
        // Validation error is already set in the hook
        return;
      }
    }
    
    void actions.submit();
  }, [isUsingEnvVars, providerDefinition, state.customKeys, state.initialKeys, actions, validateApiKey, clearApiKeyError]);

  return (
    <VStack gap={4} align="start" width="full">
      <VStack align="start" width="full" gap={4}>
        {provider.provider === "azure" && (
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

        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={provider}
        />

        <DefaultProviderSection
          state={state}
          actions={actions}
          provider={provider}
          enabledProvidersCount={enabledProvidersCount}
          project={project}
          providers={providers}
        />

        <HStack width="full" justify="end">
          <Button
            size="sm"
            colorPalette="orange"
            loading={state.isSaving || isValidatingApiKey}
            onClick={handleSave}
          >
            Save
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
};
