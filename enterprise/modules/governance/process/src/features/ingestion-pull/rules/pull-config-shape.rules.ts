// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  anthropicAdminPullConfigSchema,
  ARD_REGISTRY_ADAPTER_ID,
  ardRegistryPullConfigSchema,
  AWS_BEDROCK_AGENTS_ADAPTER_ID,
  awsBedrockAgentsPullConfigSchema,
  copilotStudioDataversePullConfigSchema,
  DATABRICKS_GENIE_ADAPTER_ID,
  databricksGeniePullConfigSchema,
  GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
  gcpVertexAgentEnginePullConfigSchema,
  OPENAI_ADMIN_ADAPTER_ID,
  openaiAdminPullConfigSchema,
  SECURITY_LAKE_ADAPTER_ID,
  securityLakePullConfigSchema,
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
  [SECURITY_LAKE_ADAPTER_ID, securityLakePullConfigSchema],
  [AWS_BEDROCK_AGENTS_ADAPTER_ID, awsBedrockAgentsPullConfigSchema],
  [GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID, gcpVertexAgentEnginePullConfigSchema],
  [ARD_REGISTRY_ADAPTER_ID, ardRegistryPullConfigSchema],
]);

/** A bucket or queue read as the source, never with the worker's own AWS identity. */
const S3_POLLING_ADAPTER_ID = "s3_polling";
/** Read by the S3 polling puller too, so it needs the same pair. */
const OPENAI_COMPLIANCE_ADAPTER_ID = "openai_compliance";
const S3_PULLER_ADAPTER_IDS: ReadonlySet<string> = new Set([
  S3_POLLING_ADAPTER_ID,
  OPENAI_COMPLIANCE_ADAPTER_ID,
]);
type RequiredCredentials = { group: string; fields: readonly (readonly [string, string])[] };
const AWS_KEY_PAIR: RequiredCredentials = {
  group: "Access keys: enter the access key ID and secret access key together",
  fields: [
    ["aws_access_key_id", "access key ID"],
    ["aws_secret_access_key", "secret access key"],
  ],
};

/**
 * The credentials an adapter cannot sign in without, by the form's name for each. The config
 * schemas leave `credentials` out because the stored form is sealed, so this is checked apart.
 */
const REQUIRED_CREDENTIALS: ReadonlyMap<string, RequiredCredentials> = new Map<
  string,
  RequiredCredentials
>([
  [
    COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
    {
      group: "App registration: enter the tenant ID, client ID and client secret together",
      fields: [
        ["tenantId", "tenant ID"],
        ["clientId", "client ID"],
        ["clientSecret", "client secret"],
      ],
    },
  ],
  [
    GCP_VERTEX_AGENT_ENGINE_ADAPTER_ID,
    {
      group: "Service account: paste the service account key JSON",
      fields: [["serviceAccountJson", "service account key"]],
    },
  ],
  [SECURITY_LAKE_ADAPTER_ID, AWS_KEY_PAIR],
  [S3_POLLING_ADAPTER_ID, AWS_KEY_PAIR],
  [OPENAI_COMPLIANCE_ADAPTER_ID, AWS_KEY_PAIR],
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
  awsConnectionId: "AWS connection",
  regions: "Regions",
  targets: "Projects and locations",
  registryUrl: "Registry address",
  searchUrl: "Search endpoint",
  bucketWidth: "Bucket width",
  startingAt: "Read history from",
  schedule: "Pull schedule",
  region: "Region",
  subscriberRoleArn: "Subscriber role ARN",
  queueUrl: "SQS queue URL",
  sources: "Sources",
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

/** The same complaints keyed by the configuration field each is about, for a form to place. */
export function findPullConfigFieldErrors(
  parserConfig: Record<string, unknown> | null | undefined,
): Record<string, string[]> {
  const adapter = parserConfig?.adapter;
  if (typeof adapter !== "string") return {};
  const schema = PULL_CONFIG_SCHEMAS.get(adapter);
  if (!schema) return {};

  const parsed = schema.safeParse(parserConfig);
  if (parsed.success) return {};

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const [field] = issue.path;
    if (typeof field !== "string") continue;
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * What is missing from the credentials a save sends, for an adapter that cannot sign in without
 * them. Read only where the save sends credentials of its own (a create, or an edit replacing
 * them), since an edit that sends none keeps the stored ones. With `deploymentAwsIdentity` an S3
 * polling source that sends no key at all reads as the deployment, so only a half pair is refused.
 */
export function findPullCredentialComplaints(
  parserConfig: Record<string, unknown> | null | undefined,
  { deploymentAwsIdentity = false }: { deploymentAwsIdentity?: boolean } = {},
): string[] {
  const adapter = parserConfig?.adapter;
  if (typeof adapter !== "string") return [];
  const required = REQUIRED_CREDENTIALS.get(adapter);
  if (!required) return [];

  const credentials = parserConfig?.credentials;
  const sent = new Map<string, unknown>(
    credentials !== null && typeof credentials === "object" ? Object.entries(credentials) : [],
  );
  const missing = required.fields
    .filter(([key]) => {
      const value = sent.get(key);
      return typeof value !== "string" || value.trim().length === 0;
    })
    .map(([, label]) => label);
  if (missing.length === 0) return [];
  const sentNone = missing.length === required.fields.length;
  if (deploymentAwsIdentity && S3_PULLER_ADAPTER_IDS.has(adapter) && sentNone) return [];

  return [`${required.group}; missing ${joinLabels(missing)}.`];
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
