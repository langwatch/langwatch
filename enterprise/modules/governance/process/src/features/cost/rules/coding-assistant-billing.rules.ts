// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { ASSISTANT_KINDS, type AssistantKind } from "@langwatch/enterprise-governance-contract";
import { z } from "zod";

const codingAssistantConfigSchema = z.looseObject({
  assistantKind: z.string(),
  bundledPlan: z.boolean(),
});

/** pi's traces arrive under its ingest key's source type, not its kind (ADR-188), so its fact names both. */
const INGEST_SOURCE_TYPES_BY_KIND: Partial<Record<AssistantKind, readonly string[]>> = {
  pi: ["pi_cli"],
};

function billingSourceTypesOf(kind: string): readonly string[] {
  return [kind, ...(INGEST_SOURCE_TYPES_BY_KIND[kind as AssistantKind] ?? [])];
}

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
      billingSourceTypesOf(parsed.data.assistantKind).includes(sourceType) &&
      parsed.data.bundledPlan === false
    );
  });
}

/** Every source type a kind bills under, so a fact per entry covers every source. */
export const CODING_ASSISTANT_BILLING_SOURCE_TYPES: readonly string[] =
  ASSISTANT_KINDS.flatMap(billingSourceTypesOf);
