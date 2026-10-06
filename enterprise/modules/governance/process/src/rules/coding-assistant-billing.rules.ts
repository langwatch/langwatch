// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { ASSISTANT_KINDS } from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

const codingAssistantConfigSchema = z.looseObject({
  assistantKind: z.string(),
  bundledPlan: z.boolean(),
});

/** Main's rule: a source is billed only by an enabled config of its kind explicitly off a bundled plan. */
export function isSourceBilledByConfigs({
  configs,
  sourceType,
}: {
  configs: readonly unknown[];
  sourceType: string;
}): boolean {
  return configs.some((candidate) => {
    const parsed = codingAssistantConfigSchema.safeParse(candidate);
    return (
      parsed.success &&
      parsed.data.assistantKind === sourceType &&
      parsed.data.bundledPlan === false
    );
  });
}

/** Each assistant kind is the source type it bills under, so a fact per kind covers every source. */
export const CODING_ASSISTANT_BILLING_SOURCE_TYPES: readonly string[] = ASSISTANT_KINDS;
