// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  awsBedrockAgentsPullConfigSchema,
  type GovernanceIngestionSourceType,
  vertexAgentEngineTargetSchema,
} from "@langwatch/enterprise-governance-contract";

import { PULL_SCHEDULE_DEFAULTS } from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import type { ComposerState } from "./source-composer-state.ts";

const HOURLY = "0 * * * *";

/** The source types whose only job is listing agents; each offers a test connection. */
export const CLOUD_AGENT_SOURCE_TYPES = [
  "aws_bedrock_agents",
  "gcp_vertex_agent_engine",
  "ard_registry",
] as const satisfies readonly GovernanceIngestionSourceType[];
export type CloudAgentSourceType = (typeof CLOUD_AGENT_SOURCE_TYPES)[number];

export function isCloudAgentSourceType(sourceType: string): sourceType is CloudAgentSourceType {
  return CLOUD_AGENT_SOURCE_TYPES.some((type) => type === sourceType);
}

function trimmed(p: Record<string, string>, key: string): string {
  return (p[key] ?? "").trim();
}

/** The regions the form holds, comma-separated, as the list the adapter reads. */
export function parseRegions(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function serializeRegions(regions: readonly string[]): string {
  return regions.join(", ");
}

/** The same check the adapter's schema runs, so the form refuses what the save would. */
export function isAwsRegion(region: string): boolean {
  return awsBedrockAgentsPullConfigSchema.shape.regions.element.validate(region);
}

export interface VertexTargetRow {
  projectId: string;
  location: string;
}

function asTargetRow(item: unknown): VertexTargetRow {
  const row = (item ?? {}) as Partial<Record<keyof VertexTargetRow, unknown>>;
  return {
    projectId: typeof row.projectId === "string" ? row.projectId : "",
    location: typeof row.location === "string" ? row.location : "",
  };
}

/**
 * The project and location rows the form holds. Stored as JSON (what an edit seeds from the
 * saved array); `project/location` pairs separated by commas read too.
 */
export function parseTargets(value: string): VertexTargetRow[] {
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(asTargetRow) : [];
    } catch {
      return [];
    }
  }
  return text.split(",").map((pair) => {
    const [projectId = "", location = ""] = pair.split("/").map((part) => part.trim());
    return { projectId, location };
  });
}

/** Rows back to the form's string; all blank is "" so the required check can see it. */
export function serializeTargets(rows: readonly VertexTargetRow[]): string {
  const isBlank = (row: VertexTargetRow) => !row.projectId.trim() && !row.location.trim();
  if (rows.every(isBlank)) return "";
  return JSON.stringify(rows);
}

export function isVertexTarget(row: VertexTargetRow): boolean {
  return vertexAgentEngineTargetSchema.validate(row);
}

/** The AWS source config, or null without a connection or with a region that is not one. */
export function buildAwsBedrockAgentsPullConfig(c: ComposerState): Record<string, unknown> | null {
  const awsConnectionId = trimmed(c.parserConfig, "awsConnectionId");
  const regions = parseRegions(trimmed(c.parserConfig, "regions"));
  if (!awsConnectionId || regions.length === 0 || !regions.every(isAwsRegion)) return null;
  return {
    adapter: "aws_bedrock_agents",
    awsConnectionId,
    regions,
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.aws_bedrock_agents || HOURLY,
  };
}

/**
 * The Google Cloud source config, or null without a valid project and location, or without a
 * key when one is required. On edit a blank key is omitted so the stored one is kept.
 */
export function buildGcpVertexAgentEnginePullConfig(
  c: ComposerState,
  { shouldRequireCredentials = true }: { shouldRequireCredentials?: boolean } = {},
): Record<string, unknown> | null {
  const targets = parseTargets(trimmed(c.parserConfig, "targets"))
    .map((row) => ({ projectId: row.projectId.trim(), location: row.location.trim() }))
    .filter((row) => row.projectId || row.location);
  const serviceAccountJson = trimmed(c.parserConfig, "credentialsServiceAccountJson");
  if (targets.length === 0 || !targets.every(isVertexTarget)) return null;
  if (!serviceAccountJson && shouldRequireCredentials) return null;
  return {
    adapter: "gcp_vertex_agent_engine",
    targets,
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.gcp_vertex_agent_engine || HOURLY,
    ...(serviceAccountJson ? { credentials: { serviceAccountJson } } : {}),
  };
}

/** The ARD source config, or null without a registry address. */
export function buildArdRegistryPullConfig(c: ComposerState): Record<string, unknown> | null {
  const registryUrl = trimmed(c.parserConfig, "registryUrl");
  const searchUrl = trimmed(c.parserConfig, "searchUrl");
  const bearerToken = trimmed(c.parserConfig, "credentialsBearerToken");
  if (!registryUrl) return null;
  return {
    adapter: "ard_registry",
    registryUrl,
    ...(searchUrl ? { searchUrl } : {}),
    schedule: c.pullSchedule.trim() || PULL_SCHEDULE_DEFAULTS.ard_registry || HOURLY,
    ...(bearerToken ? { credentials: { bearerToken } } : {}),
  };
}

const CLOUD_AGENT_BUILDERS: Record<
  CloudAgentSourceType,
  (c: ComposerState) => Record<string, unknown> | null
> = {
  aws_bedrock_agents: buildAwsBedrockAgentsPullConfig,
  gcp_vertex_agent_engine: buildGcpVertexAgentEnginePullConfig,
  ard_registry: buildArdRegistryPullConfig,
};

/**
 * What a test connection sends for an unsaved draft: the config with its secrets split out, or
 * null while the draft is not complete enough to try.
 */
export function agentListingTestInput(c: ComposerState): {
  sourceType: CloudAgentSourceType;
  config: Record<string, unknown>;
  credentials?: Record<string, string>;
} | null {
  if (!isCloudAgentSourceType(c.sourceType)) return null;
  const built = CLOUD_AGENT_BUILDERS[c.sourceType](c);
  if (!built) return null;
  const { credentials, ...config } = built;
  return {
    sourceType: c.sourceType,
    config,
    ...(credentials ? { credentials: credentials as Record<string, string> } : {}),
  };
}
