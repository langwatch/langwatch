// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  anthropicAdminPullConfigSchema,
  copilotStudioDataversePullConfigSchema,
  DATABRICKS_GENIE_ADAPTER_ID,
  databricksGeniePullConfigSchema,
  OPENAI_ADMIN_ADAPTER_ID,
  openaiAdminPullConfigSchema,
} from "@langwatch/enterprise-governance-contract";
import type { z } from "zod";

import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../microsoft/rules/dataverse-environment-service.rules.ts";

/** The adapters whose configuration schema the contract owns, read by save and by pull alike. */
const PULL_CONFIG_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  [COPILOT_STUDIO_DATAVERSE_ADAPTER_ID]: copilotStudioDataversePullConfigSchema,
  [DATABRICKS_GENIE_ADAPTER_ID]: databricksGeniePullConfigSchema,
  [ANTHROPIC_ADMIN_ADAPTER_ID]: anthropicAdminPullConfigSchema,
  [OPENAI_ADMIN_ADAPTER_ID]: openaiAdminPullConfigSchema,
};

/** The form's names for the fields an adapter can refuse, so a refusal points at what to fix. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  environmentUrl: "Environment URL",
  botIds: "Agent IDs",
  azureSubscriptionId: "Azure subscription ID",
  workspaceUrl: "Workspace URL",
  spaceIds: "Space IDs",
  warehouseId: "Warehouse ID",
  report: "Report",
  bucketWidth: "Bucket width",
  startingAt: "Read history from",
  schedule: "Pull schedule",
};

/**
 * What the adapter would refuse about this configuration, in words an admin can act on. Empty
 * for a push source, for an adapter without a contract schema, and for a configuration it reads.
 */
export function findPullConfigComplaints(
  parserConfig: Record<string, unknown> | null | undefined,
): string[] {
  const adapter = parserConfig?.adapter;
  if (typeof adapter !== "string") return [];
  const schema = PULL_CONFIG_SCHEMAS[adapter];
  if (!schema) return [];

  const parsed = schema.safeParse(parserConfig);
  if (parsed.success) return [];

  return parsed.error.issues.map((issue) => {
    const [field] = issue.path;
    const label = typeof field === "string" ? (FIELD_LABELS[field] ?? field) : "Configuration";
    return `${label}: ${issue.message}`;
  });
}
