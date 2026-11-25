// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Vertex AI Agent Engine reasoning engines as agent sightings, and the service account key and
 * token answer they are read with. Pure: the HTTP walk lives in the vertex agent engine channel.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */

import { createSign, type KeyObject } from "node:crypto";

import { z } from "zod";

import type { DiscoveredAgentRecord } from "./agent-listing.rules.ts";
import { definedMetadata, isoMomentText, ownerLabelOf } from "./cloud-agent-metadata.rules.ts";

export const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
export const JWT_BEARER_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const ASSERTION_LIFETIME_SECONDS = 3600;

export const serviceAccountKeySchema = z.object({
  type: z.literal("service_account"),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
  token_uri: z.string().optional(),
});
export type ServiceAccountKey = z.infer<typeof serviceAccountKeySchema>;

/** The stored key, or `parsed: false` when it is not a service account JSON. */
export function parseServiceAccountKey({
  json,
}: {
  json: string;
}): { parsed: true; key: ServiceAccountKey } | { parsed: false } {
  try {
    const result = serviceAccountKeySchema.safeParse(JSON.parse(json));
    return result.success ? { parsed: true, key: result.data } : { parsed: false };
  } catch {
    return { parsed: false };
  }
}

export const googleTokenResponseSchema = z.object({ access_token: z.string().min(1) });

export const reasoningEngineSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  createTime: z.string().optional(),
  updateTime: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  spec: z
    .object({
      agentFramework: z.string().optional(),
      packageSpec: z.object({ pythonVersion: z.string().optional() }).optional(),
    })
    .optional(),
});
export type ReasoningEngine = z.infer<typeof reasoningEngineSchema>;

export const reasoningEnginesPageSchema = z.object({
  reasoningEngines: reasoningEngineSchema.array().optional(),
  nextPageToken: z.string().optional(),
});

/** Google location ids are lowercase words joined by hyphens; anything else never reaches a host name. */
export function isVertexLocation(location: string): boolean {
  return /^[a-z][a-z0-9-]{1,40}$/.test(location);
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** The RS256 assertion a service account exchanges for an access token. */
export function signServiceAccountAssertion({
  clientEmail,
  privateKey,
  audience,
  nowSeconds,
}: {
  clientEmail: string;
  privateKey: KeyObject;
  audience: string;
  nowSeconds: number;
}): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: clientEmail,
      scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
      aud: audience,
      iat: nowSeconds,
      exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${base64Url(signer.sign(privateKey))}`;
}

/** One reasoning engine as the sighting `DiscoveredAgent` stores, keyed by its resource name. */
export function reasoningEngineAsAgent({
  engine,
  projectId,
  location,
}: {
  engine: ReasoningEngine;
  projectId: string;
  location: string;
}): DiscoveredAgentRecord {
  const labels = engine.labels ?? {};
  const engineId = engine.name.split("/").pop() ?? engine.name;
  const metadata = definedMetadata({
    platform: "gcp_vertex",
    project: projectId,
    location,
    owner: ownerLabelOf({ labels }),
    model: labels.model,
    tags: JSON.stringify(labels),
    description: engine.description,
    framework: engine.spec?.agentFramework,
    createdAt: isoMomentText({ value: engine.createTime }),
    updatedAt: isoMomentText({ value: engine.updateTime }),
    matchIds: JSON.stringify(engineId === engine.name ? [engine.name] : [engine.name, engineId]),
    consoleUrl: `https://console.cloud.google.com/vertex-ai/agents/locations/${encodeURIComponent(location)}/agent-engines/${encodeURIComponent(engineId)}?project=${encodeURIComponent(projectId)}`,
  });
  return {
    rawAgentId: engine.name,
    displayText: engine.displayName?.trim() || engineId,
    metadata,
  };
}
