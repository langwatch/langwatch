import {
  getModelsForProvider,
  type ModelProvider,
  type ModelProviderUncheckedReason,
} from "@langwatch/model-provider-contract";

/**
 * Probe outcomes a ping must not run after: the runtime falls back to the host key for a row that
 * carries none, so a generation would pass on a credential this row does not hold.
 */
export const UNPINGABLE_CREDENTIALS: readonly ModelProviderUncheckedReason[] = [
  "no_credential",
  "credential_masked",
];

export type PingRefusal = "credit" | "usage_limit" | "auth" | "other";

function bareModelId(id: string): string {
  return id.split("/").slice(1).join("/");
}

/**
 * The models a ping may run on this row, cheapest catalogue chat model first, then the row's own.
 * Empty when neither names one. Spec: specs/model-providers/credential-validation.feature
 */
export function findPingModels(row: Pick<ModelProvider, "provider" | "customModels">): string[] {
  const named = row.customModels.map((model) => model.id);
  const catalogued = getModelsForProvider(row.provider)
    .filter((model) => model.mode === "chat")
    .filter(
      (model) =>
        named.length === 0 || named.includes(bareModelId(model.id)) || named.includes(model.id),
    )
    .toSorted(
      (a, b) =>
        (a.pricing.inputCostPerToken ?? Number.POSITIVE_INFINITY) -
        (b.pricing.inputCostPerToken ?? Number.POSITIVE_INFINITY),
    );
  const matched = new Set(catalogued.flatMap((model) => [model.id, bareModelId(model.id)]));

  return [
    ...catalogued.map((model) => bareModelId(model.id)),
    ...named.filter((id) => !matched.has(id)),
  ];
}

/** The words a provider refused a generation with, classified. */
export function classifyPingRefusal({
  status,
  body,
}: {
  status: number | undefined;
  body: string;
}): PingRefusal {
  const text = body.toLowerCase();
  if (
    /insufficient_quota|no credits remaining|billing|exceeded your current quota|payment required/.test(
      text,
    )
  ) {
    return "credit";
  }
  if (/usage_limit_reached|usage limit|plan limit|quota exceeded/.test(text)) {
    return "usage_limit";
  }
  if (status === 401 || status === 403 || /invalid[_ ]api[_ ]key|unauthorized/.test(text)) {
    return "auth";
  }
  return "other";
}
