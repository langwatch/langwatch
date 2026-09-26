// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { PROVIDER_NAMES } from "./provider-names.ts";

/**
 * The provider's product name, or the raw key when we have never seen it.
 *
 * Exported because the day-split panel names the same providers, and two
 * tables of provider names is how one screen comes to call the same provider
 * two different things.
 */
export const providerName = (provider: string) =>
  // Own-property test, not a bare lookup: `provider` arrives from stored rows,
  // and an object literal answers an inherited name like "toString" with a
  // Function, which `??` does not treat as missing. That Function would reach
  // the label. See sourceHealthDisplay for the same guard.
  Object.hasOwn(PROVIDER_NAMES, provider)
    ? PROVIDER_NAMES[provider]!
    : provider || "Unknown provider";
