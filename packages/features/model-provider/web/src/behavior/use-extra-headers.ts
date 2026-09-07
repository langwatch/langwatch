import { useCallback, useState } from "react";
import type { ModelProviderEditorValue as MaybeStoredModelProvider } from "@langwatch/model-provider-contract";

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

export type UseExtraHeadersReturn = UseExtraHeadersState & UseExtraHeadersActions;

function buildInitialHeaders(provider: MaybeStoredModelProvider): ExtraHeader[] {
  return (provider.extraHeaders ?? []).map((h) => ({
    key: h.key,
    value: h.value,
    concealed: !!h.value,
  }));
}

const API_KEY_HEADER: ExtraHeader = { key: "api-key", value: "", concealed: false };

function replaceHeaderAt(
  headers: ExtraHeader[],
  index: number,
  change: (header: ExtraHeader) => ExtraHeader,
): ExtraHeader[] {
  return headers.map((header, i) => (i === index ? change(header) : header));
}

/** Azure gateway coupling: an empty list gets the `api-key` header it needs. */
function withApiKeyHeader(headers: ExtraHeader[]): ExtraHeader[] {
  return headers.length > 0 ? headers : [{ ...API_KEY_HEADER }];
}

function resetHeaders(
  nextProvider: MaybeStoredModelProvider,
  useApiGateway: boolean,
): ExtraHeader[] {
  const initial = buildInitialHeaders(nextProvider);
  const needsApiKeyHeader = nextProvider.provider === "azure" && useApiGateway;

  return needsApiKeyHeader ? withApiKeyHeader(initial) : initial;
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
    setExtraHeaders((prev) => [...prev, { key: "", value: "", concealed: false }]);
  }, []);

  const removeExtraHeader = useCallback((index: number) => {
    setExtraHeaders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toggleExtraHeaderConcealed = useCallback((index: number) => {
    setExtraHeaders((prev) =>
      replaceHeaderAt(prev, index, (h) => ({ ...h, concealed: !h.concealed })),
    );
  }, []);

  const setExtraHeaderKey = useCallback((index: number, key: string) => {
    setExtraHeaders((prev) => replaceHeaderAt(prev, index, (h) => ({ ...h, key })));
  }, []);

  const setExtraHeaderValue = useCallback((index: number, value: string) => {
    setExtraHeaders((prev) => replaceHeaderAt(prev, index, (h) => ({ ...h, value })));
  }, []);

  const ensureApiKeyHeader = useCallback(() => {
    setExtraHeaders(withApiKeyHeader);
  }, []);

  const reset = useCallback((nextProvider: MaybeStoredModelProvider, useApiGateway: boolean) => {
    setExtraHeaders(resetHeaders(nextProvider, useApiGateway));
  }, []);

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
