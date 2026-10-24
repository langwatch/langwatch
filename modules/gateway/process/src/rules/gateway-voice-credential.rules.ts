import {
  ModelProviderCustomKeysMissingError,
  ModelProviderNotFoundError,
} from "@langwatch/model-provider-contract";

/** The model-provider refusals meaning "no keys to read", which a voice read treats as absence. */
export function isMissingProviderKeys(error: unknown): boolean {
  return ModelProviderNotFoundError.is(error) || ModelProviderCustomKeysMissingError.is(error);
}
