// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { rateSpendNanoUsd, spendUsageSchema } from "@langwatch/gateway-contract";

import type { PulledUsageRateInput } from "../app/governance.members.ts";

/**
 * A pulled record's four quantities through the gateway's own rating (main
 * `pulled-usage-pricing.service.ts:146`); every quantity it cannot carry reads as zero.
 */
export function ratePulledUsage(input: PulledUsageRateInput): {
  costNanoUsd: number;
  rateVersion: string;
} {
  return rateSpendNanoUsd({
    model: input.model,
    usage: spendUsageSchema.parse({
      input_tokens: input.quantities.tokensInput,
      output_tokens: input.quantities.tokensOutput,
      cache_read_input_tokens: input.quantities.tokensCacheRead,
      cache_creation_input_tokens: input.quantities.tokensCacheWrite,
    }),
  });
}
