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

/**
 * The adapters whose configuration schema the contract owns, read by save and by pull alike. A
 * `Map`, so an adapter named after an inherited property ("constructor") finds no schema.
 */
const PULL_CONFIG_SCHEMAS: ReadonlyMap<string, z.ZodType> = new Map<string, z.ZodType>([
  [COPILOT_STUDIO_DATAVERSE_ADAPTER_ID, copilotStudioDataversePullConfigSchema],
  [DATABRICKS_GENIE_ADAPTER_ID, databricksGeniePullConfigSchema],
  [ANTHROPIC_ADMIN_ADAPTER_ID, anthropicAdminPullConfigSchema],
  [OPENAI_ADMIN_ADAPTER_ID, openaiAdminPullConfigSchema],
]);

/**
 * The credentials an adapter cannot sign in without, by the form's name for each. The config
 * schemas leave `credentials` out because the stored form is sealed, so this is checked apart.
 */
const REQUIRED_CREDENTIALS: ReadonlyMap<string, readonly (readonly [string, string])[]> = new Map([
  [
    COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
    [
      ["tenantId", "tenant ID"],
      ["clientId", "client ID"],
      ["clientSecret", "client secret"],
    ],
  ],
]);

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
  const schema = PULL_CONFIG_SCHEMAS.get(adapter);
  if (!schema) return [];

  const parsed = schema.safeParse(parserConfig);
  if (parsed.success) return [];

  return parsed.error.issues.map((issue) => {
    const [field] = issue.path;
    const label = typeof field === "string" ? (FIELD_LABELS[field] ?? field) : "Configuration";
    return `${label}: ${issue.message}`;
  });
}

/**
 * What is missing from the credentials a save sends, for an adapter that cannot sign in without
 * them. Read only where the save sends credentials of its own (a create, or an edit replacing
 * them), since an edit that sends none keeps the stored ones.
 */
export function findPullCredentialComplaints(
  parserConfig: Record<string, unknown> | null | undefined,
): string[] {
  const adapter = parserConfig?.adapter;
  if (typeof adapter !== "string") return [];
  const required = REQUIRED_CREDENTIALS.get(adapter);
  if (!required) return [];

  const credentials = parserConfig?.credentials;
  const sent = new Map<string, unknown>(
    credentials !== null && typeof credentials === "object" ? Object.entries(credentials) : [],
  );
  const missing = required
    .filter(([key]) => {
      const value = sent.get(key);
      return typeof value !== "string" || value.trim().length === 0;
    })
    .map(([, label]) => label);
  if (missing.length === 0) return [];

  return [
    `App registration: enter the tenant ID, client ID and client secret together; missing ${joinLabels(missing)}.`,
  ];
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
