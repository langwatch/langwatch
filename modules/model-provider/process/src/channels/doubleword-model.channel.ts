import type { DoublewordModel } from "../rules/doubleword-models.rules.ts";

/** Why Doubleword's model list could not be read this run. */
type DoublewordModelsUnavailableReason =
  | "key_not_set"
  | "transport_failed"
  | "http_status"
  | "malformed_body";

export type DoublewordModelList =
  | { outcome: "fetched"; models: DoublewordModel[] }
  | { outcome: "unavailable"; reason: DoublewordModelsUnavailableReason; detail: string };

/**
 * Doubleword's admin models endpoint: the only source for its models and
 * prices. It takes a platform key. An inference key is refused with a 401.
 */
export abstract class DoublewordModelChannel {
  abstract fetchModels(input: { apiKey: string }): Promise<DoublewordModelList>;
}
