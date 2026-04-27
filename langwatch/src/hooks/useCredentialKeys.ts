import { useCallback, useMemo, useRef, useState } from "react";
import {
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../server/modelProviders/registry";
import {
  buildCustomKeyState,
  getDisplayKeysForProvider,
  getSchemaShape,
} from "../utils/modelProviderHelpers";

export type UseCredentialKeysState = {
  useApiGateway: boolean;
  customKeys: Record<string, string>;
  displayKeys: Record<string, unknown>;
  initialKeys: Record<string, unknown>;
};

export type UseCredentialKeysActions = {
  setUseApiGateway: (
    use: boolean,
    onGatewayToggle?: (useGateway: boolean) => void,
  ) => void;
  setCustomKey: (key: string, value: string) => void;
  setManaged: (managed: boolean) => void;
  /**
   * Resets credential key state from the given provider.
   * Returns the new `useApiGateway` boolean so the orchestrator
   * can pass it to other sub-hooks that depend on it.
   */
  reset: (provider: MaybeStoredModelProvider) => boolean;
};

export type UseCredentialKeysReturn = UseCredentialKeysState &
  UseCredentialKeysActions & {
    /** Exposed for submit validation. */
    originalStoredKeysRef: React.RefObject<Record<string, unknown>>;
    /** Exposed for submit validation. */
    providerDefinition:
      | (typeof modelProvidersRegistry)[keyof typeof modelProvidersRegistry]
      | undefined;
  };

function computeInitialUseApiGateway(
  provider: MaybeStoredModelProvider,
): boolean {
  if (provider.provider === "azure" && provider.customKeys) {
    return !!(provider.customKeys as Record<string, unknown>)
      .AZURE_API_GATEWAY_BASE_URL;
  }
  return false;
}

export function useCredentialKeys({
  provider,
}: {
  provider: MaybeStoredModelProvider;
}): UseCredentialKeysReturn {
  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const originalStoredKeysRef = useRef<Record<string, unknown>>(
    (provider.customKeys as Record<string, unknown>) || {},
  );

  const originalSchemaShape = useMemo<Record<string, unknown>>(() => {
    return providerDefinition?.keysSchema
      ? getSchemaShape(providerDefinition.keysSchema)
      : {};
  }, [providerDefinition?.keysSchema]);

  const [useApiGateway, setUseApiGatewayState] = useState<boolean>(() =>
    computeInitialUseApiGateway(provider),
  );

  const displayKeys = useMemo(() => {
    return getDisplayKeysForProvider(
      provider.provider,
      useApiGateway,
      originalSchemaShape,
    );
  }, [provider.provider, useApiGateway, originalSchemaShape]);

  const [customKeys, setCustomKeys] = useState<Record<string, string>>(() =>
    buildCustomKeyState(
      displayKeys,
      originalStoredKeysRef.current ?? {},
      undefined,
      {
        providerEnabledWithEnvVars: provider.enabled,
      },
    ),
  );

  const setUseApiGateway = useCallback(
    (
      use: boolean,
      onGatewayToggle?: (useGateway: boolean) => void,
    ) => {
      setUseApiGatewayState(use);
      setCustomKeys((previousKeys) => {
        originalStoredKeysRef.current = {
          ...originalStoredKeysRef.current,
          ...previousKeys,
        };

        const nextDisplayKeys = getDisplayKeysForProvider(
          provider.provider,
          use,
          originalSchemaShape,
        );

        return buildCustomKeyState(
          nextDisplayKeys,
          originalStoredKeysRef.current,
          previousKeys,
        );
      });

      onGatewayToggle?.(use);
    },
    [provider.provider, originalSchemaShape],
  );

  const setCustomKey = useCallback((key: string, value: string) => {
    setCustomKeys((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setManaged = useCallback((managed: boolean) => {
    if (managed) {
      setCustomKeys({ MANAGED: "true" });
    } else {
      setCustomKeys({});
    }
  }, []);

  const reset = useCallback(
    (nextProvider: MaybeStoredModelProvider): boolean => {
      const storedKeys =
        (nextProvider.customKeys as Record<string, unknown>) ?? {};
      originalStoredKeysRef.current = storedKeys;

      const nextUseApiGateway = computeInitialUseApiGateway(nextProvider);
      setUseApiGatewayState(nextUseApiGateway);

      const nextDisplayKeys = getDisplayKeysForProvider(
        nextProvider.provider,
        nextUseApiGateway,
        originalSchemaShape,
      );

      setCustomKeys(() =>
        buildCustomKeyState(nextDisplayKeys, storedKeys, undefined, {
          providerEnabledWithEnvVars: nextProvider.enabled,
        }),
      );

      return nextUseApiGateway;
    },
    [originalSchemaShape],
  );

  return {
    useApiGateway,
    customKeys,
    displayKeys,
    initialKeys: originalStoredKeysRef.current,
    originalStoredKeysRef,
    providerDefinition,
    setUseApiGateway,
    setCustomKey,
    setManaged,
    reset,
  };
}
