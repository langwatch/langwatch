import {
  VStack,
  HStack,
  Spacer,
  Button,
  Field,
  Grid,
  GridItem,
  Input,
} from "@chakra-ui/react";
import React, { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "react-feather";
import { FullWidthFormControl } from "../FullWidthFormControl";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { ModelProviderSelector, useProviderSelectionOptions } from "../ModelProviderSelector";
import { useModelProviderForm } from "../../hooks/useModelProviderForm";
import { useDrawer } from "~/hooks/useDrawer";
import { dependencies } from "../../injection/dependencies.client";
import {
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../../server/modelProviders/registry";
import { KEY_CHECK } from "../../utils/constants";
import { SmallLabel } from "../SmallLabel";
import { Switch } from "../ui/switch";

type ModelProviderFormProps = {
  projectId?: string | undefined;
  modelProviderId?: string | undefined;
};

export const ModelProviderForm = ({
  projectId,
  modelProviderId,
}: ModelProviderFormProps) => {
  const { providers, isLoading } = useModelProvidersSettings({
    projectId: projectId,
  });
  const { closeDrawer } = useDrawer();

  // Get available providers and select the first one (or custom)
  const { selectOptions } = useProviderSelectionOptions(providers, undefined);
  const firstAvailableProvider = selectOptions[0]?.value || "custom";

  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(
    firstAvailableProvider,
  );

  // Update selected provider when options change
  useEffect(() => {
    if (selectOptions.length > 0 && !selectedProvider) {
      setSelectedProvider(firstAvailableProvider);
    }
  }, [selectOptions, firstAvailableProvider, selectedProvider]);

  // Create provider object for the form hook
  const provider: MaybeStoredModelProvider = useMemo(() => {
    if (modelProviderId && providers) {
      // Edit mode: find existing provider (has values from DB)
      const existing = Object.values(providers).find(
        (p) => p.id === modelProviderId,
      );
      if (existing) return existing;
    }

    // Create mode: create new provider object
    const providerKey = selectedProvider || "custom";

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
  }, [modelProviderId, providers, selectedProvider]);

  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    onSuccess: () => {
      closeDrawer();
    },
  });

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const ManagedModelProvider = dependencies.managedModelProviderComponent?.({
    projectId: projectId ?? "",
    organizationId: "", // Not needed for form
    provider,
  });
  const ManagedModelProviderAny = ManagedModelProvider as any;

  useEffect(() => {
    if (ManagedModelProviderAny) {
      actions.setManaged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(state.customKeys)]);

  return (
    <VStack gap={4} align="start" width="full">
      <FullWidthFormControl label="Model Provider">
        <ModelProviderSelector
          provider={selectedProvider}
          providers={providers}
          onChange={(provider) => {
            setSelectedProvider(provider);
          }}
          size="full"
        />
      </FullWidthFormControl>

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

        {ManagedModelProviderAny ? (
          React.createElement(ManagedModelProviderAny, { provider })
        ) : (
          <Field.Root invalid={!!state.errors.customKeysRoot}>
            <Grid
              templateColumns="auto auto"
              gap={4}
              rowGap={2}
              paddingTop={4}
              width="full"
            >
              <GridItem color="gray.500">
                <SmallLabel>Key</SmallLabel>
              </GridItem>
              <GridItem color="gray.500">
                <SmallLabel>Value</SmallLabel>
              </GridItem>
              {Object.keys(state.displayKeys).map((key) => (
                <React.Fragment key={key}>
                  <GridItem alignContent="center" fontFamily="monospace">
                    {key}
                  </GridItem>
                  <GridItem>
                    <Input
                      value={state.customKeys[key] ?? ""}
                      onChange={(e) =>
                        actions.setCustomKey(key, e.target.value)
                      }
                      type={
                        KEY_CHECK.some((k) => key.includes(k))
                          ? "password"
                          : "text"
                      }
                      autoComplete="off"
                      placeholder={
                        (state.displayKeys as any)[key]?._def
                          ?.typeName === "ZodOptional"
                          ? "optional"
                          : undefined
                      }
                    />
                  </GridItem>
                </React.Fragment>
              ))}
            </Grid>
            <Field.ErrorText>
              {state.errors.customKeysRoot}
            </Field.ErrorText>
          </Field.Root>
        )}

        {/* Extra Headers - Only for Azure and Custom, always visible */}
        {(provider.provider === "azure" ||
          provider.provider === "custom") && (
          <VStack width="full" align="start" paddingTop={4}>
            {state.extraHeaders.length > 0 && (
              <Grid
                templateColumns="auto auto auto auto"
                gap={4}
                rowGap={2}
                width="full"
              >
                <GridItem color="gray.500" colSpan={4}>
                  <SmallLabel>Extra Headers</SmallLabel>
                </GridItem>
                {state.extraHeaders.map((h, index) => (
                  <React.Fragment key={index}>
                    <GridItem>
                      <Input
                        value={h.key}
                        onChange={(e) =>
                          actions.setExtraHeaderKey(
                            index,
                            e.target.value,
                          )
                        }
                        placeholder="Header name"
                        autoComplete="off"
                      />
                    </GridItem>
                    <GridItem>
                      <Input
                        value={h.value}
                        onChange={(e) =>
                          actions.setExtraHeaderValue(
                            index,
                            e.target.value,
                          )
                        }
                        type={h.concealed ? "password" : "text"}
                        placeholder="Header value"
                        autoComplete="off"
                      />
                    </GridItem>
                    <GridItem>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          actions.toggleExtraHeaderConcealed(index)
                        }
                      >
                        {h.concealed ? (
                          <EyeOff size={16} />
                        ) : (
                          <Eye size={16} />
                        )}
                      </Button>
                    </GridItem>
                    <GridItem>
                      <Button
                        size="sm"
                        variant="ghost"
                        colorPalette="red"
                        onClick={() => actions.removeExtraHeader(index)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </GridItem>
                  </React.Fragment>
                ))}
              </Grid>
            )}

            <HStack width="full" justify="end">
              <Button
                size="xs"
                variant="outline"
                onClick={actions.addExtraHeader}
              >
                <Plus size={16} />
                Add Header
              </Button>
            </HStack>
          </VStack>
        )}

        <HStack width="full">
          <Spacer />
          <Button
            size="sm"
            colorPalette="orange"
            loading={state.isSaving}
            onClick={() => {
              void actions.submit();
            }}
          >
            Save
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
};