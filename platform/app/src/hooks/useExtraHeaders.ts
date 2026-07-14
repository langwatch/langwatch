import { useCallback, useState } from "react";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";

export type ExtraHeader = { key: string; value: string; concealed?: boolean };

export type UseExtraHeadersState = {
  extraHeaders: ExtraHeader[];
};

export type UseExtraHeadersActions = {
  addExtraHeader: () => void;
  removeExtraHeader: (index: number) => void;
  toggleExtraHeaderConcealed: (index: number) => void;
  setExtraHeaderKey: (index: number, key: string) => void;
  setExtraHeaderValue: (index: number, value: string) => void;
  ensureApiKeyHeader: () => void;
  reset: (provider: MaybeStoredModelProvider, useApiGateway: boolean) => void;
};

export type UseExtraHeadersReturn = UseExtraHeadersState &
  UseExtraHeadersActions;

function buildInitialHeaders(
  provider: MaybeStoredModelProvider,
): ExtraHeader[] {
  return (provider.extraHeaders ?? []).map((h) => ({
    key: h.key,
    value: h.value,
    concealed: !!h.value,
  }));
}

export function useExtraHeaders({
  provider,
}: {
  provider: MaybeStoredModelProvider;
}): UseExtraHeadersReturn {
  const [extraHeaders, setExtraHeaders] = useState<ExtraHeader[]>(() =>
    buildInitialHeaders(provider),
  );

  const addExtraHeader = useCallback(() => {
    setExtraHeaders((prev) => [
      ...prev,
      { key: "", value: "", concealed: false },
    ]);
  }, []);

  const removeExtraHeader = useCallback((index: number) => {
    setExtraHeaders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toggleExtraHeaderConcealed = useCallback((index: number) => {
    setExtraHeaders((prev) =>
      prev.map((h, i) =>
        i === index ? { ...h, concealed: !h.concealed } : h,
      ),
    );
  }, []);

  const setExtraHeaderKey = useCallback((index: number, key: string) => {
    setExtraHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, key } : h)),
    );
  }, []);

  const setExtraHeaderValue = useCallback((index: number, value: string) => {
    setExtraHeaders((prev) =>
      prev.map((h, i) => (i === index ? { ...h, value } : h)),
    );
  }, []);

  /** Adds an `api-key` header if the list is currently empty (Azure gateway coupling). */
  const ensureApiKeyHeader = useCallback(() => {
    setExtraHeaders((prev) => {
      if (prev.length > 0) return prev;
      return [{ key: "api-key", value: "", concealed: false }];
    });
  }, []);

  const reset = useCallback(
    (nextProvider: MaybeStoredModelProvider, useApiGateway: boolean) => {
      let nextExtraHeaders = buildInitialHeaders(nextProvider);

      if (
        nextProvider.provider === "azure" &&
        useApiGateway &&
        nextExtraHeaders.length === 0
      ) {
        nextExtraHeaders = [{ key: "api-key", value: "", concealed: false }];
      }

      setExtraHeaders(nextExtraHeaders);
    },
    [],
  );

  return {
    extraHeaders,
    addExtraHeader,
    removeExtraHeader,
    toggleExtraHeaderConcealed,
    setExtraHeaderKey,
    setExtraHeaderValue,
    ensureApiKeyHeader,
    reset,
  };
}
