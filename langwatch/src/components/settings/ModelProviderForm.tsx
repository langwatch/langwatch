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
  const enabledProvidersCount = useMemo(() => {
    if (!providers) return 0;
    return Object.values(providers).filter((p) => p.enabled).length;
  }, [providers]);

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

    // Final fallback for new providers (not yet created in DB)
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

  // Use project data as primary source (auto-updates when organization.getAll is invalidated)
  // Effective defaults (project values with fallbacks) are computed inside the hook
  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    project,
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
    
    // Validate keys according to schema before submitting
    if (providerDefinition?.keysSchema) {
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

    // Validate API key if provider supports it
    const isValid = await validateApiKey();
    if (!isValid) {
      // Validation error is already set in the hook
      return;
    }
    
    void actions.submit();
  }, [providerDefinition, state.customKeys, actions, validateApiKey, clearApiKeyError]);

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
